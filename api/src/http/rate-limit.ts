import { ErrorCode } from '@ecommerce/shared'
import { hashOpaqueToken } from '../auth/opaque-token.ts'
import type { DbClient } from '../db.ts'
import { AppError } from './errors.ts'

/** At most `max` hits per fixed `windowMs` window. */
export type RateLimit = { name: string; max: number; windowMs: number }

const MINUTE = 60 * 1000

// Per-IP limits are looser than per-email: many customers can share an IP (carrier NAT).
export const RATE_LIMITS = {
  loginPerEmail: { name: 'login:email', max: 10, windowMs: 15 * MINUTE },
  loginPerIp: { name: 'login:ip', max: 50, windowMs: 15 * MINUTE },
  forgotPasswordPerEmail: { name: 'forgot-password:email', max: 3, windowMs: 60 * MINUTE },
  forgotPasswordPerIp: { name: 'forgot-password:ip', max: 20, windowMs: 60 * MINUTE },
  verificationEmailPerCustomer: { name: 'verification-email:customer', max: 3, windowMs: 60 * MINUTE },
  // Provisional. 409s count too, since every attempt briefly reserves stock.
  checkoutPerIp: { name: 'checkout:ip', max: 5, windowMs: 60 * MINUTE },
  // Each call creates a gateway link; looser than checkout since failed payments get retried.
  payRemainderPerIp: { name: 'pay-remainder:ip', max: 10, windowMs: 60 * MINUTE },
  // Quotes with a voucher: blocks code guessing (spec M5, provisional).
  voucherCheckPerIp: { name: 'voucher-check:ip', max: 10, windowMs: MINUTE },
  // Support requests (spec M6b, provisional): free text, so limit spam per IP and per request.
  supportCreatePerIp: { name: 'support-create:ip', max: 5, windowMs: 60 * MINUTE },
  supportMessagePerRequest: { name: 'support-message:request', max: 20, windowMs: 60 * MINUTE },
  supportImagePerIp: { name: 'support-image:ip', max: 20, windowMs: 60 * MINUTE },
  // Chatbot (spec M8, provisional): every message uses the store's shared free model quota (ADR 0017).
  chatMessagePerIp: { name: 'chat-message:ip', max: 60, windowMs: 60 * MINUTE },
  // Handoff creates a request and sends email without verification: strict per IP (spec M8, provisional).
  chatHandoffPerIp: { name: 'chat-handoff:ip', max: 3, windowMs: 24 * 60 * MINUTE },
} satisfies Record<string, RateLimit>

/**
 * Counts one hit per limit; any over `max` throws 429 with `retryAfter`. `subject` is an IP, email or id.
 * Counted in Postgres so every API instance shares the counters.
 */
export async function enforceRateLimits(
  db: DbClient,
  hits: { limit: RateLimit; subject: string }[],
  message = 'Bạn đã thử quá nhiều lần, vui lòng thử lại sau',
) {
  let retryAfter = 0
  for (const { limit, subject } of hits) {
    // Hash the key so the table holds no readable email or IP.
    const key = hashOpaqueToken(`${limit.name}:${subject}`)
    // One statement resets an expired window and increments, so concurrent requests never miss a count.
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
  if (retryAfter > 0) throw new AppError(429, ErrorCode.RATE_LIMITED, message, undefined, undefined, retryAfter)
}
