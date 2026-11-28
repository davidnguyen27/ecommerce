import type { StockAdjustmentReason, StockMovementKind } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import type { Prisma, StockMovement } from '../../generated/prisma/client.ts'

/** A variant locked to change stock or reserve. */
export type LockedVariant = { id: string; sku: string; productId: string; onHand: number; reserved: number }

/** Units of one variant to reserve (or release). */
export type Reservation = { variantId: string; quantity: number }

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
 * Stock as other modules use it (ADR 0006, 0007): availability, reservations and the only way to change stock. Writes
 * run in the caller's transaction and lock variants by id order, so overlapping requests do not deadlock.
 */
export interface IStockLedger {
  /** Variants in stock (`on_hand - reserved > 0`); ids only, never quantities. */
  inStockIds(db: DbClient, variantIds: readonly string[]): Promise<Set<string>>
  /** Cart lines buyable in full; ids only. */
  enoughStockIds(db: DbClient, lines: readonly { variantId: string; quantity: number }[]): Promise<Set<string>>
  /** Codes of orders holding the variant (reserved quantity > 0). */
  ordersHoldingVariant(db: DbClient, variantId: string): Promise<number[]>
  /** Reserves for an order; if any line is short nothing is reserved and the short variant ids are returned. */
  reserve(
    tx: Prisma.TransactionClient,
    lines: readonly Reservation[],
  ): Promise<{ ok: true } | { ok: false; shortVariantIds: string[] }>
  /** Releases reserved stock (cancel, expiry). */
  release(tx: Prisma.TransactionClient, lines: readonly Reservation[]): Promise<void>
  /**
   * Locks the variants, lets `plan` decide from the locked stock, then updates stock and writes the ledger. Negative
   * stock, or stock below what stays reserved, throws 409 and rolls back.
   */
  change(
    tx: Prisma.TransactionClient,
    actorId: string,
    variantIds: readonly string[],
    plan: (locked: ReadonlyMap<string, LockedVariant>) => StockChange[] | Promise<StockChange[]>,
  ): Promise<{ locked: ReadonlyMap<string, LockedVariant>; movements: StockMovement[] }>
}
