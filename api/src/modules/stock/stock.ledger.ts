import type { DbClient } from '../../core/db.ts'
import { conflictField } from '../../core/errors.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type { IStockLedger, LockedVariant, Reservation, StockChange } from './stock.interface.ts'
import type { StockRepository } from './stock.repository.ts'

/**
 * The stock ledger other modules use (ADR 0006, 0007). Stateless besides the repository: every call works in the
 * `db` or transaction it is given, so one shared instance is safe.
 */
export class StockLedger implements IStockLedger {
  constructor(private readonly repo: StockRepository) {}

  /**
   * Variants in `variantIds` that are in stock. Customers only see in/out of stock, read straight from stock rather
   * than the published version (ADR 0006), and never see quantities.
   */
  async inStockIds(db: DbClient, variantIds: readonly string[]): Promise<Set<string>> {
    return new Set(await this.repo.inStockIds(db, variantIds))
  }

  /**
   * Cart lines buyable in full: on-hand minus reserved covers the quantity wanted. Like `inStockIds`, returns ids only,
   * never quantities.
   */
  async enoughStockIds(db: DbClient, lines: readonly { variantId: string; quantity: number }[]): Promise<Set<string>> {
    return new Set(await this.repo.enoughStockIds(db, lines))
  }

  /**
   * Codes of orders holding the variant: unpaid in-stock orders or paid ones not handed over, and pre-orders partly or
   * fully reserved from arrivals.
   */
  ordersHoldingVariant(db: DbClient, variantId: string) {
    return this.repo.ordersHoldingVariant(db, variantId)
  }

  /**
   * Reserves stock for an order (ADR 0007), on the same lock path as `change`. Every line needs enough
   * `on_hand - reserved`; if any is short nothing is reserved and the short variant ids are returned, so the caller
   * can report per line and roll back. No ledger rows: the goods have not left.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    lines: readonly Reservation[],
  ): Promise<{ ok: true } | { ok: false; shortVariantIds: string[] }> {
    const { locked } = await this.repo.lockVariants(
      tx,
      lines.map((l) => l.variantId),
    )
    const short = lines.filter((line) => {
      const variant = locked.get(line.variantId)
      return !variant || variant.onHand - variant.reserved < line.quantity
    })
    if (short.length > 0) return { ok: false, shortVariantIds: short.map((l) => l.variantId) }
    for (const line of lines) await this.repo.addReserved(tx, line.variantId, line.quantity)
    return { ok: true }
  }

  /** Releases reserved stock (cancel, expiry), on the same lock path as `change`. No ledger rows. */
  async release(tx: Prisma.TransactionClient, lines: readonly Reservation[]) {
    await this.repo.lockVariants(
      tx,
      lines.map((l) => l.variantId),
    )
    for (const line of lines) await this.repo.removeReserved(tx, line.variantId, line.quantity)
  }

  /**
   * The only way to change stock: locks variants by id order (no deadlocks), lets `plan` decide based on the locked
   * stock, then updates stock and writes the ledger. Call in the `audited()` transaction; negative stock, or stock
   * below what stays reserved after `releaseReserved`, throws 409 and rolls back.
   */
  async change(
    tx: Prisma.TransactionClient,
    actorId: string,
    variantIds: readonly string[],
    plan: (locked: ReadonlyMap<string, LockedVariant>) => StockChange[] | Promise<StockChange[]>,
  ) {
    const { ids, locked } = await this.repo.lockVariants(tx, variantIds)
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
        const orderCodes = await this.repo.ordersHoldingVariant(tx, variant.id)
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
        await this.repo.setStock(tx, id, value, reservedValue)
      }
    }
    const created = []
    for (const m of movements) {
      created.push(
        await this.repo.createMovement(tx, {
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
        }),
      )
    }
    return { locked, movements: created }
  }
}
