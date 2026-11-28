import { deleteOldConversations } from '../../modules/chatbot/index.ts'
import type { DbClient } from '../db.ts'
import { RATE_LIMITS } from '../middleware/rate-limit.ts'

const LONGEST_RATE_LIMIT_WINDOW_MS = Math.max(...Object.values(RATE_LIMITS).map((limit) => limit.windowMs))

/**
 * Deletes expired tokens and rate-limit counters, and chatbot conversations older than 90 days (spec M8). Expired rows
 * are never read again (refresh tokens inherit the family expiry, so deleting does not break reuse detection).
 */
export async function deleteExpiredRecords(db: DbClient, now = new Date()) {
  const [refreshTokens, customerTokens, rateLimitBuckets, chatConversations] = await Promise.all([
    db.refreshToken.deleteMany({ where: { expiresAt: { lte: now } } }),
    db.customerToken.deleteMany({ where: { expiresAt: { lte: now } } }),
    db.rateLimitBucket.deleteMany({
      where: { windowStart: { lte: new Date(now.getTime() - LONGEST_RATE_LIMIT_WINDOW_MS) } },
    }),
    deleteOldConversations(db, now),
  ])
  return {
    refreshTokens: refreshTokens.count,
    customerTokens: customerTokens.count,
    rateLimitBuckets: rateLimitBuckets.count,
    chatConversations,
  }
}
