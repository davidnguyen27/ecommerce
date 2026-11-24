import type { Db } from '../../src/db.ts'

const APPEND_ONLY = {
  order_event: { trigger: 'order_event_no_update_delete', column: 'created_at' },
  payment_transaction: { trigger: 'payment_transaction_no_update_delete', column: 'paid_at' },
} as const

/**
 * Moves back the write time of rows for order `orderCode` in an append-only table (`kind` events, or every
 * transaction). Reports group by delivery or payment date, but these rows can only be written "now" and a trigger
 * blocks UPDATE, so the test briefly disables the trigger on its own DB, in one transaction.
 */
export async function backdate(
  prisma: Db,
  table: keyof typeof APPEND_ONLY,
  orderCode: number,
  at: Date,
  kind?: string,
) {
  const { trigger, column } = APPEND_ONLY[table]
  const filter = kind ? ` AND "kind" = '${kind}'` : ''
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`),
    prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "${column}" = $1::timestamptz AT TIME ZONE 'UTC'
       WHERE "order_id" = (SELECT "id" FROM "order" WHERE "code" = $2)${filter}`,
      at.toISOString(),
      orderCode,
    ),
    prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`),
  ])
}

/**
 * Moves every existing ledger row of a variant to `at`, so they fall before the report period (the ledger is
 * append-only too).
 */
export async function backdateStock(prisma: Db, variantId: string, at: Date) {
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`ALTER TABLE "stock_movement" DISABLE TRIGGER "stock_movement_no_update_delete"`),
    prisma.$executeRawUnsafe(
      `UPDATE "stock_movement" SET "created_at" = $1::timestamptz AT TIME ZONE 'UTC' WHERE "variant_id" = $2::uuid`,
      at.toISOString(),
      variantId,
    ),
    prisma.$executeRawUnsafe(`ALTER TABLE "stock_movement" ENABLE TRIGGER "stock_movement_no_update_delete"`),
  ])
}
