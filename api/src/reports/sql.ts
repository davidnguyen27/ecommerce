import { Prisma } from '../generated/prisma/client.ts'
import { inPeriod, type Period } from './period.ts'

// Đoạn SQL dùng chung của các báo cáo.

/**
 * CTE `"root"` (`id`, `origin`): mỗi khoản hoàn kèm nguồn của khoản gốc đầu chuỗi tạo lại. Khoản `retry` mang nguồn của
 * khoản nó thay, để báo cáo chỉ chia theo hủy, đối soát, trả hàng.
 */
export const REFUND_ROOTS = Prisma.sql`
  WITH RECURSIVE "root" AS (
    SELECT "id", "origin" FROM "refund" WHERE "retry_of_id" IS NULL
    UNION ALL
    SELECT c."id", "root"."origin" FROM "refund" c JOIN "root" ON c."retry_of_id" = "root"."id"
  )`

/**
 * Điều kiện "đơn giao tới khách trong kỳ" (ADR 0016) trên sự kiện đơn `e` và đơn `o`: đơn hoàn tất có sự kiện
 * `delivered` trong kỳ; ngày giao là lúc ghi sự kiện đó.
 */
export const deliveredInPeriod = (period: Period) =>
  Prisma.sql`e."kind" = 'delivered' AND o."status" = 'completed' AND ${inPeriod(Prisma.sql`e."created_at"`, period)}`
