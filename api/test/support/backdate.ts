import type { Db } from '../../src/db.ts'

const APPEND_ONLY = {
  order_event: { trigger: 'order_event_no_update_delete', column: 'created_at' },
  payment_transaction: { trigger: 'payment_transaction_no_update_delete', column: 'paid_at' },
} as const

/**
 * Dời thời điểm ghi của các dòng thuộc đơn `orderCode` ở một bảng chỉ ghi thêm (sự kiện `kind`, hay mọi giao dịch).
 * Báo cáo nhóm theo ngày giao hay ngày nhận tiền, mà các dòng này chỉ ghi được "bây giờ" và trigger chặn UPDATE. Vì vậy
 * test tạm tắt trigger trên DB riêng của nó, chỉ trong một transaction.
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
