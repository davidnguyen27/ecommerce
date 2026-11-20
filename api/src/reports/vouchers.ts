import type { VoucherFigures, VoucherKind, VoucherReport } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { inPeriod, type Period } from './period.ts'

type Row = {
  voucherId: string
  code: string
  kind: VoucherKind
  amount: bigint | null
  percent: number | null
  maxDiscount: bigint | null
  redemptions: number
  discount: bigint
  netGoods: bigint
  deliveredOrders: number
}

/**
 * Hiệu quả mã giảm giá (spec M7): đơn có mã, tạo trong kỳ, chưa hủy. Kỳ theo ngày tạo đơn vì câu hỏi là mã kéo được
 * bao nhiêu đơn, không phải doanh thu đã giao.
 */
export async function voucherReport(db: DbClient, period: Period): Promise<VoucherReport> {
  const rows = await db.$queryRaw<Row[]>`
    SELECT v."id"::text AS "voucherId", v."code", v."kind"::text AS "kind", v."amount", v."percent",
      v."max_discount" AS "maxDiscount",
      count(*)::int AS "redemptions", sum(o."discount")::bigint AS "discount",
      sum(o."subtotal" - o."discount")::bigint AS "netGoods",
      (count(*) FILTER (WHERE o."fulfillment_status" = 'delivered'))::int AS "deliveredOrders"
    FROM "order" o JOIN "voucher" v ON v."id" = o."voucher_id"
    WHERE o."status" <> 'cancelled' AND ${inPeriod(Prisma.sql`o."created_at"`, period)}
    GROUP BY v."id"
    ORDER BY "redemptions" DESC, "discount" DESC, v."code"`

  const totals: VoucherFigures = { redemptions: 0, discount: 0, netGoods: 0, deliveredOrders: 0 }
  const items = rows.map((row) => {
    const figures = {
      redemptions: row.redemptions,
      discount: Number(row.discount),
      netGoods: Number(row.netGoods),
      deliveredOrders: row.deliveredOrders,
    }
    for (const key of Object.keys(totals) as (keyof VoucherFigures)[]) totals[key] += figures[key]
    return {
      voucherId: row.voucherId,
      code: row.code,
      kind: row.kind,
      amount: row.amount === null ? null : Number(row.amount),
      percent: row.percent,
      maxDiscount: row.maxDiscount === null ? null : Number(row.maxDiscount),
      ...figures,
    }
  })
  return { from: period.from, to: period.to, items, totals }
}
