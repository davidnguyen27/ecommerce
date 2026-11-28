import {
  ADJUSTMENT_INPUT,
  StockAdjustmentRequest,
  StockMovementQuery,
  StockQuery,
  adjustmentDelta,
} from '@ecommerce/shared'
import type { z } from 'zod'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { conflictField, invalidField } from '../../core/errors.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type { StockLedger } from './stock.ledger.ts'
import type { StockRepository } from './stock.repository.ts'

/** Stock and ledger screens, and stock adjustments by staff. */
export class StockService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: StockRepository,
    private readonly ledger: StockLedger,
  ) {}

  list(query: z.output<typeof StockQuery>) {
    const where: Prisma.ProductVariantWhereInput = {
      status: query.status,
      product: { productType: query.productType, brandId: query.brandId },
      ...(query.q && {
        OR: [
          { sku: { contains: query.q, mode: 'insensitive' } },
          { product: { name: { contains: query.q, mode: 'insensitive' } } },
        ],
      }),
    }
    const byName: Prisma.ProductVariantOrderByWithRelationInput[] = [
      { product: { name: 'asc' } },
      { sortOrder: 'asc' },
      { sku: 'asc' },
    ]
    const orderBy =
      query.sort === 'name' ? byName : [{ onHand: query.sort === 'on_hand_asc' ? 'asc' : 'desc' } as const, ...byName]
    return this.repo.page(this.prisma, where, orderBy, query)
  }

  movements(query: z.output<typeof StockMovementQuery>) {
    const where: Prisma.StockMovementWhereInput = {
      variantId: query.variantId,
      kind: query.kind,
      createdAt: {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lt: new Date(query.to) }),
      },
    }
    return this.repo.movements(this.prisma, where, query)
  }

  stockItem(variantId: string) {
    return this.repo.findStockRow(this.prisma, variantId)
  }

  /**
   * Adjusts one variant's stock. `expectedOnHand` must match what is on hand (else 409 with the current value); an
   * adjustment that changes nothing writes nothing. Returns whether a movement was written.
   */
  async adjust(input: z.output<typeof StockAdjustmentRequest>, ctx: RequestContext) {
    return audited(this.prisma, ctx, async (tx, audit) => {
      const { locked, movements } = await this.ledger.change(tx, ctx.staffId, [input.variantId], (variants) => {
        const variant = variants.get(input.variantId)
        if (!variant) throw invalidField('variantId', 'Biến thể không tồn tại')
        if (variant.onHand !== input.expectedOnHand) {
          throw conflictField(
            'expectedOnHand',
            `Tồn đã đổi thành ${variant.onHand} trong lúc bạn đang nhập; kiểm tra lại rồi gửi lại`,
            { onHand: variant.onHand },
          )
        }
        const amount = 'countedQuantity' in input ? input.countedQuantity : input.quantity
        const quantity = adjustmentDelta(input.reason, amount, variant.onHand)
        if (quantity === 0) return []
        const path = ADJUSTMENT_INPUT[input.reason].field
        return [{ variantId: variant.id, quantity, kind: 'adjustment', reason: input.reason, note: input.note, path }]
      })
      const [movement] = movements
      if (!movement) return false
      const variant = locked.get(input.variantId)!
      await audit({
        action: 'stock.adjust',
        entityType: 'product_variant',
        entityId: variant.id,
        before: { sku: variant.sku, onHand: variant.onHand },
        after: { sku: variant.sku, onHand: movement.onHandAfter, reason: input.reason, note: input.note },
      })
      return true
    })
  }
}
