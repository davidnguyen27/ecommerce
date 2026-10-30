import type { DbClient } from '../db.ts'
import { RATE_LIMITS } from '../http/rate-limit.ts'

const LONGEST_RATE_LIMIT_WINDOW_MS = Math.max(...Object.values(RATE_LIMITS).map((limit) => limit.windowMs))

/**
 * Xóa token và bộ đếm giới hạn tần suất đã hết hạn. Hàng đã hết hạn không còn được đọc
 * (refresh token kế thừa hạn của cả family, nên xóa không làm hỏng việc phát hiện dùng lại).
 */
export async function deleteExpiredRecords(db: DbClient, now = new Date()) {
  const [refreshTokens, customerTokens, rateLimitBuckets] = await Promise.all([
    db.refreshToken.deleteMany({ where: { expiresAt: { lte: now } } }),
    db.customerToken.deleteMany({ where: { expiresAt: { lte: now } } }),
    db.rateLimitBucket.deleteMany({
      where: { windowStart: { lte: new Date(now.getTime() - LONGEST_RATE_LIMIT_WINDOW_MS) } },
    }),
  ])
  return {
    refreshTokens: refreshTokens.count,
    customerTokens: customerTokens.count,
    rateLimitBuckets: rateLimitBuckets.count,
  }
}
