import type { Response } from 'express'
import { ErrorCode } from '@ecommerce/shared'
import { hashOpaqueToken } from '../auth/opaque-token.ts'
import type { DbClient } from '../db.ts'
import { AppError } from './errors.ts'

/** Tối đa `max` lần trong mỗi cửa sổ cố định `windowMs`. */
export type RateLimit = { name: string; max: number; windowMs: number }

const MINUTE = 60 * 1000

// Mức theo IP rộng hơn theo email, vì nhiều khách có thể dùng chung một IP (NAT của nhà mạng).
export const RATE_LIMITS = {
  loginPerEmail: { name: 'login:email', max: 10, windowMs: 15 * MINUTE },
  loginPerIp: { name: 'login:ip', max: 50, windowMs: 15 * MINUTE },
  forgotPasswordPerEmail: { name: 'forgot-password:email', max: 3, windowMs: 60 * MINUTE },
  forgotPasswordPerIp: { name: 'forgot-password:ip', max: 20, windowMs: 60 * MINUTE },
  verificationEmailPerCustomer: { name: 'verification-email:customer', max: 3, windowMs: 60 * MINUTE },
  // Số tạm, chờ chủ doanh nghiệp xác nhận. Tính cả lần bị 409 vì mỗi lần thử đều giữ hàng trong chốc lát.
  checkoutPerIp: { name: 'checkout:ip', max: 5, windowMs: 60 * MINUTE },
} satisfies Record<string, RateLimit>

/**
 * Tính một lần thử vào mỗi bộ đếm; bộ đếm nào vượt `max` thì đặt `Retry-After` và ném 429.
 * `subject` là IP, email hoặc id, tùy giới hạn. Đếm trong Postgres để mọi instance API dùng chung.
 */
export async function enforceRateLimits(
  db: DbClient,
  res: Response,
  hits: { limit: RateLimit; subject: string }[],
  message = 'Bạn đã thử quá nhiều lần, vui lòng thử lại sau',
) {
  let retryAfter = 0
  for (const { limit, subject } of hits) {
    // Băm khóa để bảng đếm không chứa email hay IP dạng đọc được.
    const key = hashOpaqueToken(`${limit.name}:${subject}`)
    // Một câu lệnh vừa mở cửa sổ mới khi cửa sổ cũ đã hết, vừa tăng đếm, nên các request đồng thời không đếm sót.
    const [row] = await db.$queryRaw<{ hits: number; retry_after: number }[]>`
      INSERT INTO "rate_limit_bucket" ("key", "window_start", "hits") VALUES (${key}, now(), 1)
      ON CONFLICT ("key") DO UPDATE SET
        "window_start" = CASE WHEN "rate_limit_bucket"."window_start" <= now() - make_interval(secs => ${limit.windowMs / 1000}::double precision)
          THEN now() ELSE "rate_limit_bucket"."window_start" END,
        "hits" = CASE WHEN "rate_limit_bucket"."window_start" <= now() - make_interval(secs => ${limit.windowMs / 1000}::double precision)
          THEN 1 ELSE "rate_limit_bucket"."hits" + 1 END
      RETURNING "hits",
        ceil(extract(epoch FROM "window_start" + make_interval(secs => ${limit.windowMs / 1000}::double precision) - now()))::int AS retry_after`
    if (row && row.hits > limit.max) retryAfter = Math.max(retryAfter, row.retry_after, 1)
  }
  if (retryAfter > 0) {
    res.setHeader('Retry-After', String(retryAfter))
    throw new AppError(429, ErrorCode.RATE_LIMITED, message)
  }
}
