import {
  ErrorCode,
  StockReceiptPreviewRequest,
  StockReceiptRequest,
  type FieldError,
  type StockReceiptPreview,
} from '@ecommerce/shared'
import type { z } from 'zod'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { AppError } from '../../core/errors.ts'
import type { CustomerMail } from '../../core/jobs/queues.ts'
import type { StockReceiptPorts } from './stock-receipt.interface.ts'
import type { StockReceiptRepository } from './stock-receipt.repository.ts'

/** Stock receipts. No edit or delete: mistakes are fixed with an adjustment. */
export class StockReceiptService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: StockReceiptRepository,
    private readonly mail: CustomerMail,
    private readonly ports: StockReceiptPorts,
  ) {}

  list(window: { page: number; pageSize: number }) {
    return this.repo.page(this.prisma, window)
  }

  async get(id: string) {
    const receipt = await this.repo.find(this.prisma, id)
    if (!receipt) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy phiếu nhập')
    return receipt
  }

  /** Variant ids by SKU for the receipt lines; duplicate or unknown SKUs give 400 per line. */
  private async resolveLines(lines: readonly { sku: string }[]) {
    const variants = await this.repo.variantIdsBySku(
      this.prisma,
      lines.map((l) => l.sku),
    )
    const idOf = new Map(variants.map((v) => [v.sku, v.id]))
    const fields: FieldError[] = []
    const firstLine = new Map<string, number>()
    lines.forEach(({ sku }, index) => {
      const path = `lines.${index}.sku`
      if (firstLine.has(sku)) fields.push({ path, message: `SKU ${sku} trùng với dòng ${firstLine.get(sku)! + 1}` })
      else if (!idOf.has(sku)) fields.push({ path, message: `Không có biến thể nào có SKU ${sku}` })
      firstLine.set(sku, firstLine.get(sku) ?? index)
    })
    if (fields.length) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Phiếu nhập có dòng không hợp lệ', fields)
    return idOf
  }

  /** How the arriving quantities would split between waiting pre-orders and regular stock; nothing written. */
  async preview(input: z.output<typeof StockReceiptPreviewRequest>): Promise<StockReceiptPreview> {
    const idOf = await this.resolveLines(input.lines)
    const plans = await this.ports.arrivals.plan(
      this.prisma,
      input.lines.map((line) => ({ variantId: idOf.get(line.sku)!, quantity: line.quantity })),
    )
    return {
      lines: input.lines.map((line, index) => {
        const plan = plans[index]!
        return {
          sku: line.sku,
          quantity: line.quantity,
          forPreorders: plan.received - plan.toStock,
          preorderOrders: plan.allocations.length,
          ordersCompleted: plan.allocations.filter((a) => a.fills).length,
          toStock: plan.toStock,
        }
      }),
    }
  }

  /**
   * Records the receipt and its stock movements. Arrivals are reserved at once for waiting deposited pre-orders, in
   * the same transaction: never regular stock that another customer could buy (ADR 0013). Returns the receipt id.
   */
  async create(input: z.output<typeof StockReceiptRequest>, ctx: RequestContext) {
    const idOf = await this.resolveLines(input.lines)
    const actorId = ctx.staffId
    return audited(this.prisma, ctx, async (tx, audit) => {
      const receipt = await this.repo.create(tx, {
        supplierName: input.supplierName,
        receivedOn: new Date(input.receivedOn),
        note: input.note,
        createdById: actorId,
      })
      const { locked, movements } = await this.ports.stock.change(tx, actorId, [...idOf.values()], () =>
        input.lines.map((line, index) => ({
          variantId: idOf.get(line.sku)!,
          quantity: line.quantity,
          kind: 'receipt' as const,
          receiptId: receipt.id,
          path: `lines.${index}.quantity`,
        })),
      )
      // The stock change has locked the variants.
      const plans = await this.ports.arrivals.plan(
        tx,
        input.lines.map((line) => ({ variantId: idOf.get(line.sku)!, quantity: line.quantity })),
        { lock: true },
      )
      const arrivedOrderCodes = await this.ports.arrivals.apply(tx, this.mail, plans, { receiptId: receipt.id })
      const preorderAllocations = plans.flatMap((plan) =>
        plan.allocations.map((a) => ({
          sku: locked.get(plan.variantId)!.sku,
          orderCode: a.orderCode,
          quantity: a.take,
        })),
      )
      await audit({
        action: 'stock.receipt.create',
        entityType: 'stock_receipt',
        entityId: receipt.id,
        after: {
          supplierName: input.supplierName,
          receivedOn: input.receivedOn,
          note: input.note,
          lines: movements.map((m) => ({
            sku: locked.get(m.variantId)!.sku,
            quantity: m.quantity,
            onHandAfter: m.onHandAfter,
          })),
          ...(preorderAllocations.length && { preorderAllocations, arrivedOrderCodes }),
        },
      })
      return receipt.id
    })
  }
}
