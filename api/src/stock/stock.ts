import type { StockAdjustmentReason, StockMovementKind } from '@ecommerce/shared'
import type { DbClient } from '../core/db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { conflictField } from '../core/errors.ts'

/**
 * Variants in `variantIds` that are in stock. Customers only see in/out of stock, read straight from stock rather than
 * the published version (ADR 0006), and never see quantities.
 */
export async function inStockIds(db: DbClient, variantIds: readonly string[]): Promise<Set<string>> {
  // Stock reserved for orders is no longer sellable (ADR 0007).
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id"::text AS id FROM "product_variant"
    WHERE "id" = ANY(${[...variantIds]}::uuid[]) AND "on_hand" - "reserved" > 0`
  return new Set(rows.map((r) => r.id))
}

/**
 * Cart lines buyable in full: on-hand minus reserved covers the quantity wanted. Like `inStockIds`, returns ids only,
 * never quantities.
 */
export async function enoughStockIds(
  db: DbClient,
  lines: readonly { variantId: string; quantity: number }[],
): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT v."id"::text AS id
    FROM "product_variant" v
    JOIN unnest(${lines.map((l) => l.variantId)}::uuid[], ${lines.map((l) => l.quantity)}::int[]) AS l("id", "quantity")
      ON l."id" = v."id"
    WHERE v."on_hand" - v."reserved" >= l."quantity"`
  return new Set(rows.map((r) => r.id))
}

/** A variant locked to change stock or reserve. */
export type LockedVariant = { id: string; sku: string; productId: string; onHand: number; reserved: number }

/** Locks variants by id order, so requests on overlapping variants do not deadlock. */
async function lockVariants(tx: Prisma.TransactionClient, variantIds: readonly string[]) {
  const ids = [...new Set(variantIds)].sort()
  const rows = await tx.$queryRaw<LockedVariant[]>`
    SELECT "id"::text AS id, "sku", "product_id"::text AS "productId", "on_hand" AS "onHand", "reserved"
    FROM "product_variant" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`
  return { ids, locked: new Map(rows.map((row) => [row.id, row])) }
}

/**
 * Codes of orders holding the variant: unpaid in-stock orders or paid ones not handed over, and pre-orders partly or
 * fully reserved from arrivals.
 */
export async function ordersHoldingVariant(db: DbClient, variantId: string): Promise<number[]> {
  const orders = await db.order.findMany({
    where: { lines: { some: { variantId, reservedQuantity: { gt: 0 } } } },
    select: { code: true },
    orderBy: { code: 'asc' },
  })
  return orders.map((o) => o.code)
}

/** Units of one variant to reserve (or release). */
export type Reservation = { variantId: string; quantity: number }

/**
 * Reserves stock for an order (ADR 0007), on the same lock path as `changeStock`. Every line needs enough
 * `on_hand - reserved`; if any is short nothing is reserved and the short variant ids are returned, so the caller can
 * report per line and roll back. No ledger rows: the goods have not left.
 */
export async function reserveStock(
  tx: Prisma.TransactionClient,
  lines: readonly Reservation[],
): Promise<{ ok: true } | { ok: false; shortVariantIds: string[] }> {
  const { locked } = await lockVariants(
    tx,
    lines.map((l) => l.variantId),
  )
  const short = lines.filter((line) => {
    const variant = locked.get(line.variantId)
    return !variant || variant.onHand - variant.reserved < line.quantity
  })
  if (short.length > 0) return { ok: false, shortVariantIds: short.map((l) => l.variantId) }
  for (const line of lines) {
    await tx.productVariant.update({ where: { id: line.variantId }, data: { reserved: { increment: line.quantity } } })
  }
  return { ok: true }
}

/** Releases reserved stock (cancel, expiry), on the same lock path as `changeStock`. No ledger rows. */
export async function releaseStock(tx: Prisma.TransactionClient, lines: readonly Reservation[]) {
  await lockVariants(
    tx,
    lines.map((l) => l.variantId),
  )
  for (const line of lines) {
    await tx.productVariant.update({ where: { id: line.variantId }, data: { reserved: { decrement: line.quantity } } })
  }
}

/** One stock change; `path` is the request field to report a shortage on. */
export type StockChange = {
  variantId: string
  /** Signed, non-zero. */
  quantity: number
  kind: StockMovementKind
  reason?: StockAdjustmentReason
  note?: string
  /** Receipt; required for kind `receipt` (check constraint). */
  receiptId?: string
  /** The sale's or return's order; required for kinds `sale` and `return` (check constraint). */
  orderId?: string
  /** Support request of returned goods or exchange goods sent out (M6b). */
  supportRequestId?: string
  /**
   * Reserved units released along with this change (positive): handover deducts on-hand and the order's reservation
   * together, so the "on-hand not below reserved" check uses what remains reserved.
   */
  releaseReserved?: number
  path: string
}

/**
 * The only way to change stock: locks variants by id order (no deadlocks), lets `plan` decide based on the locked
 * stock, then updates stock and writes the ledger. Call in the `audited()` transaction; negative stock, or stock below
 * what stays reserved after `releaseReserved`, throws 409 and rolls back.
 */
export async function changeStock(
  tx: Prisma.TransactionClient,
  actorId: string,
  variantIds: readonly string[],
  plan: (locked: ReadonlyMap<string, LockedVariant>) => StockChange[] | Promise<StockChange[]>,
) {
  const { ids, locked } = await lockVariants(tx, variantIds)
  // `plan` may read more (e.g. whether the variant has ledger rows); reads here are under the lock.
  const changes = await plan(locked)

  const onHand = new Map([...locked.values()].map((row) => [row.id, row.onHand]))
  const reserved = new Map([...locked.values()].map((row) => [row.id, row.reserved]))
  const movements = []
  for (const change of changes) {
    const variant = locked.get(change.variantId)
    if (!ids.includes(change.variantId)) throw new Error(`Biến thể ${change.variantId} chưa được khóa`)
    // The variant was deleted between the read outside the transaction and the lock.
    if (!variant) throw conflictField(change.path, 'Biến thể không còn tồn tại, hãy tải lại trang')
    const after = onHand.get(variant.id)! + change.quantity
    const reservedAfter = reserved.get(variant.id)! - (change.releaseReserved ?? 0)
    if (reservedAfter < 0) throw new Error(`Nhả ${change.releaseReserved} của ${variant.sku} nhiều hơn số đang giữ`)
    if (after < 0) {
      throw conflictField(change.path, `Tồn của ${variant.sku} không đủ: hiện còn ${onHand.get(variant.id)}`)
    }
    // Reserved stock already belongs to customers; going below it means handling those orders first (ADR 0007).
    if (change.quantity < 0 && after < reservedAfter) {
      const orderCodes = await ordersHoldingVariant(tx, variant.id)
      throw conflictField(
        change.path,
        `Tồn của ${variant.sku} không thể thấp hơn ${reservedAfter} đang giữ cho đơn ${orderCodes.map((c) => `#${c}`).join(', ')}`,
        { reserved: reservedAfter, orderCodes },
      )
    }
    onHand.set(variant.id, after)
    reserved.set(variant.id, reservedAfter)
    movements.push({ ...change, onHandAfter: after })
  }

  for (const [id, value] of onHand) {
    const before = locked.get(id)!
    const reservedValue = reserved.get(id)!
    if (value !== before.onHand || reservedValue !== before.reserved) {
      await tx.productVariant.update({ where: { id }, data: { onHand: value, reserved: reservedValue } })
    }
  }
  const created = []
  for (const m of movements) {
    created.push(
      await tx.stockMovement.create({
        data: {
          variantId: m.variantId,
          kind: m.kind,
          quantity: m.quantity,
          onHandAfter: m.onHandAfter,
          reason: m.reason ?? null,
          note: m.note ?? '',
          receiptId: m.receiptId ?? null,
          orderId: m.orderId ?? null,
          supportRequestId: m.supportRequestId ?? null,
          actorId,
        },
      }),
    )
  }
  return { locked, movements: created }
}
