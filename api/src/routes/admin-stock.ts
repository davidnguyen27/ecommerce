import { Router } from 'express'
import {
  ErrorCode,
  StockAdjustmentRequest,
  StockMovementQuery,
  StockQuery,
  type AttributeValues,
  type StockItem,
  type StockMovementPage,
  type StockPage,
} from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import type { Db, DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import { changeStock } from '../stock/stock.ts'

const STOCK_INCLUDE = {
  product: {
    select: { id: true, name: true, productType: true, status: true, brand: { select: { id: true, name: true } } },
  },
} as const satisfies Prisma.ProductVariantInclude

type StockRow = Prisma.ProductVariantGetPayload<{ include: typeof STOCK_INCLUDE }>

function toStockItem(variant: StockRow): StockItem {
  const { brand, ...product } = variant.product
  return {
    variantId: variant.id,
    sku: variant.sku,
    attributes: variant.attributes as AttributeValues,
    status: variant.status,
    onHand: variant.onHand,
    product,
    brand,
  }
}

async function loadStockItem(db: DbClient, variantId: string) {
  return toStockItem(await db.productVariant.findUniqueOrThrow({ where: { id: variantId }, include: STOCK_INCLUDE }))
}

/**
 * Tồn kho và sổ xuất nhập. Xem cần `catalog.edit`, `price.edit` hoặc `stock.adjust`
 * (người soạn danh mục và đặt giá cần biết tồn); đổi tồn cần `stock.adjust`.
 */
export function adminStockRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('catalog.edit', 'price.edit', 'stock.adjust'))
    .get('/', async (req, res) => {
      const query = parse(StockQuery, req.query)
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
      const [variants, total] = await Promise.all([
        prisma.productVariant.findMany({
          where,
          include: STOCK_INCLUDE,
          orderBy,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.productVariant.count({ where }),
      ])
      const body: StockPage = { items: variants.map(toStockItem), total, page: query.page, pageSize: query.pageSize }
      res.json(body)
    })
    .get('/movements', async (req, res) => {
      const query = parse(StockMovementQuery, req.query)
      const where: Prisma.StockMovementWhereInput = {
        variantId: query.variantId,
        kind: query.kind,
        createdAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lt: new Date(query.to) }),
        },
      }
      const [movements, total] = await Promise.all([
        prisma.stockMovement.findMany({
          where,
          include: {
            variant: { select: { id: true, sku: true, product: { select: { id: true, name: true } } } },
            actor: { select: { id: true, name: true, email: true } },
          },
          orderBy: { seq: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.stockMovement.count({ where }),
      ])
      const body: StockMovementPage = {
        items: movements.map(({ variant: { product, ...variant }, ...m }) => ({
          id: m.id,
          kind: m.kind,
          quantity: m.quantity,
          onHandAfter: m.onHandAfter,
          reason: m.reason,
          note: m.note,
          variant,
          product,
          actor: m.actor,
          createdAt: m.createdAt.toISOString(),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
      res.json(body)
    })
    .post('/adjustments', requirePermission('stock.adjust'), async (req, res) => {
      const input = parse(StockAdjustmentRequest, req.body)
      const changed = await audited(prisma, req, async (tx, audit) => {
        const { locked, movements } = await changeStock(tx, currentStaff(req).id, [input.variantId], (variants) => {
          const variant = variants.get(input.variantId)
          if (!variant) throw invalidField('variantId', 'Biến thể không tồn tại')
          if (variant.onHand !== input.expectedOnHand) {
            const message = `Tồn đã đổi thành ${variant.onHand} trong lúc bạn đang nhập; kiểm tra lại rồi gửi lại`
            throw new AppError(409, ErrorCode.CONFLICT, message, [{ path: 'expectedOnHand', message }])
          }
          const quantity =
            input.reason === 'stocktake'
              ? input.countedQuantity - variant.onHand
              : input.reason === 'other'
                ? input.quantity
                : -input.quantity
          if (quantity === 0) return []
          const path = input.reason === 'stocktake' ? 'countedQuantity' : 'quantity'
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
      const body: StockItem = await loadStockItem(prisma, input.variantId)
      res.status(changed ? 201 : 200).json(body)
    })
}
