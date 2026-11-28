import { ACTOR_SELECT } from '../../core/audit/audited.ts'
import type { DbClient } from '../../core/db.ts'
import { pageWindow } from '../../core/pagination.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type { LockedVariant } from './stock.interface.ts'

export const STOCK_INCLUDE = {
  product: {
    select: { id: true, name: true, productType: true, status: true, brand: { select: { id: true, name: true } } },
  },
} as const satisfies Prisma.ProductVariantInclude

export const MOVEMENT_INCLUDE = {
  variant: { select: { id: true, sku: true, product: { select: { id: true, name: true } } } },
  actor: { select: ACTOR_SELECT },
  order: { select: { code: true } },
  supportRequest: { select: { code: true } },
} as const satisfies Prisma.StockMovementInclude

export type StockRow = Prisma.ProductVariantGetPayload<{ include: typeof STOCK_INCLUDE }>
export type MovementRow = Prisma.StockMovementGetPayload<{ include: typeof MOVEMENT_INCLUDE }>

type Window = { page: number; pageSize: number }

/** Variant stock columns and the stock ledger. Every method takes `db`; no transactions opened here. */
export class StockRepository {
  async inStockIds(db: DbClient, variantIds: readonly string[]) {
    // Stock reserved for orders is no longer sellable (ADR 0007).
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT "id"::text AS id FROM "product_variant"
      WHERE "id" = ANY(${[...variantIds]}::uuid[]) AND "on_hand" - "reserved" > 0`
    return rows.map((r) => r.id)
  }

  async enoughStockIds(db: DbClient, lines: readonly { variantId: string; quantity: number }[]) {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT v."id"::text AS id
      FROM "product_variant" v
      JOIN unnest(${lines.map((l) => l.variantId)}::uuid[], ${lines.map((l) => l.quantity)}::int[]) AS l("id", "quantity")
        ON l."id" = v."id"
      WHERE v."on_hand" - v."reserved" >= l."quantity"`
    return rows.map((r) => r.id)
  }

  /** Locks variants by id order, so requests on overlapping variants do not deadlock. */
  async lockVariants(tx: Prisma.TransactionClient, variantIds: readonly string[]) {
    const ids = [...new Set(variantIds)].sort()
    const rows = await tx.$queryRaw<LockedVariant[]>`
      SELECT "id"::text AS id, "sku", "product_id"::text AS "productId", "on_hand" AS "onHand", "reserved"
      FROM "product_variant" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`
    return { ids, locked: new Map(rows.map((row) => [row.id, row])) }
  }

  async ordersHoldingVariant(db: DbClient, variantId: string) {
    const orders = await db.order.findMany({
      where: { lines: { some: { variantId, reservedQuantity: { gt: 0 } } } },
      select: { code: true },
      orderBy: { code: 'asc' },
    })
    return orders.map((o) => o.code)
  }

  async addReserved(tx: Prisma.TransactionClient, variantId: string, quantity: number) {
    await tx.productVariant.update({ where: { id: variantId }, data: { reserved: { increment: quantity } } })
  }

  async removeReserved(tx: Prisma.TransactionClient, variantId: string, quantity: number) {
    await tx.productVariant.update({ where: { id: variantId }, data: { reserved: { decrement: quantity } } })
  }

  async setStock(tx: Prisma.TransactionClient, variantId: string, onHand: number, reserved: number) {
    await tx.productVariant.update({ where: { id: variantId }, data: { onHand, reserved } })
  }

  createMovement(tx: Prisma.TransactionClient, data: Prisma.StockMovementUncheckedCreateInput) {
    return tx.stockMovement.create({ data })
  }

  async page(
    db: DbClient,
    where: Prisma.ProductVariantWhereInput,
    orderBy: Prisma.ProductVariantOrderByWithRelationInput[],
    window: Window,
  ) {
    const [variants, total] = await Promise.all([
      db.productVariant.findMany({ where, include: STOCK_INCLUDE, orderBy, ...pageWindow(window) }),
      db.productVariant.count({ where }),
    ])
    return { variants, total }
  }

  findStockRow(db: DbClient, variantId: string) {
    return db.productVariant.findUniqueOrThrow({ where: { id: variantId }, include: STOCK_INCLUDE })
  }

  async movements(db: DbClient, where: Prisma.StockMovementWhereInput, window: Window) {
    const [movements, total] = await Promise.all([
      db.stockMovement.findMany({ where, include: MOVEMENT_INCLUDE, orderBy: { seq: 'desc' }, ...pageWindow(window) }),
      db.stockMovement.count({ where }),
    ])
    return { movements, total }
  }
}
