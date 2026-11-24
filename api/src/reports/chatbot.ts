import type { ChatbotFigures, ChatbotReport } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { bucketOf, inPeriod, type Period } from './period.ts'

/**
 * Chatbot report (spec M8): conversations by start time, customer messages by send time, calls and tokens from
 * `chat_usage_day`. Conversations are deleted after 90 days (except handed-off ones), so older periods lack
 * conversation and message counts; per-model figures stay complete.
 */
export async function chatbotReport(db: DbClient, period: Period): Promise<ChatbotReport> {
  const conversationAt = Prisma.sql`c."created_at"`
  const messageAt = Prisma.sql`m."created_at"`
  const [conversations, messages, models] = await Promise.all([
    db.$queryRaw<{ bucket: string; conversations: number; handedOff: number }[]>`
      SELECT ${bucketOf(conversationAt, period)} AS "bucket", count(*)::int AS "conversations",
        count(c."support_request_id")::int AS "handedOff"
      FROM "chat_conversation" c
      WHERE ${inPeriod(conversationAt, period)}
      GROUP BY 1`,
    db.$queryRaw<{ bucket: string; customerMessages: number; exhausted: number; failed: number }[]>`
      SELECT ${bucketOf(messageAt, period)} AS "bucket", count(*)::int AS "customerMessages",
        count(*) FILTER (WHERE m."error" = 'exhausted')::int AS "exhausted",
        count(*) FILTER (WHERE m."error" = 'failed')::int AS "failed"
      FROM "chat_message" m
      WHERE m."role" = 'customer' AND ${inPeriod(messageAt, period)}
      GROUP BY 1`,
    // `day` is already a Vietnam-time calendar day.
    db.$queryRaw<ChatbotReport['models']>`
      SELECT u."model", sum(u."calls")::int AS "calls", sum(u."input_tokens")::int AS "inputTokens",
        sum(u."output_tokens")::int AS "outputTokens", sum(u."rate_limited")::int AS "rateLimited",
        sum(u."errors")::int AS "errors"
      FROM "chat_usage_day" u
      WHERE u."day" BETWEEN ${period.from}::date AND ${period.to}::date
      GROUP BY 1
      ORDER BY 2 DESC, 1`,
  ])

  const rows = new Map<string, ChatbotFigures>(
    period.buckets.map((bucket) => [bucket, { conversations: 0, customerMessages: 0, handedOff: 0 }]),
  )
  for (const row of conversations) {
    const figures = rows.get(row.bucket)!
    figures.conversations += row.conversations
    figures.handedOff += row.handedOff
  }
  for (const row of messages) rows.get(row.bucket)!.customerMessages += row.customerMessages

  const sum = (key: keyof ChatbotFigures) => [...rows.values()].reduce((total, figures) => total + figures[key], 0)
  const total = {
    conversations: sum('conversations'),
    customerMessages: sum('customerMessages'),
    handedOff: sum('handedOff'),
  }
  return {
    from: period.from,
    to: period.to,
    groupBy: period.groupBy,
    rows: [...rows].map(([bucket, figures]) => ({ period: bucket, ...figures })),
    total: {
      ...total,
      handoffRate: total.conversations ? total.handedOff / total.conversations : null,
      exhaustedTurns: messages.reduce((n, row) => n + row.exhausted, 0),
      failedTurns: messages.reduce((n, row) => n + row.failed, 0),
    },
    models,
  }
}
