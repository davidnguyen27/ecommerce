import { z } from 'zod'
import {
  CHAT_MESSAGES_PER_CONVERSATION,
  ErrorCode,
  type ChatConversationView,
  type ChatMessageView,
  type ChatUnavailableReason,
  type ChatbotSettings,
} from '@ecommerce/shared'
import type { LlmAttempt, LlmClient } from '../../core/adapters/llm.ts'
import type { DbClient } from '../../core/db.ts'
import type { ChatMessage } from '../../generated/prisma/client.ts'
import { AppError } from '../../core/errors.ts'
import { vnDate } from '../report/index.ts'
import { HISTORY_LIMIT } from './chatbot-prompt.ts'

/** Tokens of one model call, by the model that answered. */
export type ModelUsage = { model: string; input: number; output: number }

/** `chat_message.products`: products the chatbot suggested in that message. */
export const StoredProducts = z.array(z.object({ slug: z.string(), name: z.string() }))

/** After this much silence the next message opens a new conversation (spec M8). */
export const CONVERSATION_IDLE_MS = 24 * 60 * 60_000
/** Conversations whose last message is older than this are deleted by the cleanup job (spec M8). */
export const CONVERSATION_RETENTION_MS = 90 * 24 * 60 * 60_000

const DEFAULT_SETTINGS: ChatbotSettings = { enabled: false, responseTimeNote: '' }

export async function readChatbotSettings(db: DbClient): Promise<ChatbotSettings> {
  const row = await db.chatbotSetting.findUnique({ where: { id: true } })
  return row ? { enabled: row.enabled, responseTimeNote: row.responseTimeNote } : DEFAULT_SETTINGS
}

/** Why the chatbot cannot answer now, or `null` if it can. */
export function unavailableReason(settings: ChatbotSettings, llm: LlmClient | undefined): ChatUnavailableReason | null {
  if (!settings.enabled) return 'disabled'
  if (!llm) return 'unconfigured'
  return llm.status().every((model) => model.exhaustedUntil !== null) ? 'exhausted' : null
}

export function toMessageView(message: ChatMessage): ChatMessageView {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    failed: message.error !== null,
    products: StoredProducts.parse(message.products),
    createdAt: message.createdAt.toISOString(),
  }
}

const isActive = (conversation: { lastMessageAt: Date; customerMessageCount: number }, now: Date) =>
  now.getTime() - conversation.lastMessageAt.getTime() < CONVERSATION_IDLE_MS &&
  conversation.customerMessageCount < CHAT_MESSAGES_PER_CONVERSATION

export async function conversationView(db: DbClient, id: string, now = new Date()): Promise<ChatConversationView> {
  const conversation = await db.chatConversation.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!conversation) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy cuộc trò chuyện')
  return { id, active: isActive(conversation, now), messages: conversation.messages.map(toMessageView) }
}

/**
 * Stores the customer's message in the current conversation, or a new one when there is no id, it is not found, or it
 * has been silent over 24 h. Locks the conversation row so two concurrent messages cannot pass the 30-message limit.
 * Returns the conversation, the new message and the recent messages for the model.
 */
export async function appendCustomerMessage(
  tx: DbClient,
  input: { conversationId?: string; content: string; ipHash: string },
  now: Date,
) {
  let conversationId: string | undefined
  if (input.conversationId) {
    const [locked] = await tx.$queryRaw<{ id: string; last_message_at: Date; customer_message_count: number }[]>`
      SELECT "id", "last_message_at", "customer_message_count" FROM "chat_conversation"
      WHERE "id" = ${input.conversationId}::uuid FOR UPDATE`
    if (locked && now.getTime() - locked.last_message_at.getTime() < CONVERSATION_IDLE_MS) {
      if (locked.customer_message_count >= CHAT_MESSAGES_PER_CONVERSATION) {
        throw new AppError(
          429,
          ErrorCode.RATE_LIMITED,
          `Cuộc trò chuyện đã đủ ${CHAT_MESSAGES_PER_CONVERSATION} câu hỏi. Bấm "Bắt đầu lại" để hỏi tiếp.`,
        )
      }
      conversationId = locked.id
    }
  }
  if (conversationId) {
    await tx.chatConversation.update({
      where: { id: conversationId },
      data: { customerMessageCount: { increment: 1 }, lastMessageAt: now },
    })
  } else {
    conversationId = (
      await tx.chatConversation.create({
        data: { ipHash: input.ipHash, customerMessageCount: 1, createdAt: now, lastMessageAt: now },
      })
    ).id
  }
  const message = await tx.chatMessage.create({
    data: { conversationId, role: 'customer', content: input.content, createdAt: now },
  })
  const recent = await tx.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
  })
  return { conversationId, message, history: recent.reverse() }
}

/**
 * Adds a turn's model calls to `chat_usage_day`: each real call (skipped models excluded) counts once; tokens come only
 * from the model that answered.
 */
export async function recordUsage(db: DbClient, attempts: readonly LlmAttempt[], usage: ModelUsage | null, at: Date) {
  const day = vnDate(at)
  for (const attempt of attempts) {
    if (attempt.outcome === 'skipped') continue
    const tokens = usage && attempt.outcome === 'ok' && attempt.model === usage.model ? usage : { input: 0, output: 0 }
    const rateLimited = attempt.outcome === 'rate_limited' ? 1 : 0
    const errors = attempt.outcome === 'error' ? 1 : 0
    await db.$executeRaw`
      INSERT INTO "chat_usage_day" ("day", "model", "calls", "input_tokens", "output_tokens", "rate_limited", "errors")
      VALUES (${day}::date, ${attempt.model}, 1, ${tokens.input}, ${tokens.output}, ${rateLimited}, ${errors})
      ON CONFLICT ("day", "model") DO UPDATE SET
        "calls" = "chat_usage_day"."calls" + 1,
        "input_tokens" = "chat_usage_day"."input_tokens" + EXCLUDED."input_tokens",
        "output_tokens" = "chat_usage_day"."output_tokens" + EXCLUDED."output_tokens",
        "rate_limited" = "chat_usage_day"."rate_limited" + EXCLUDED."rate_limited",
        "errors" = "chat_usage_day"."errors" + EXCLUDED."errors"`
  }
}

/** Deletes conversations idle over 90 days (messages too), except handed-off ones. Run nightly by the cleanup job. */
export async function deleteOldConversations(db: DbClient, now = new Date()) {
  const { count } = await db.chatConversation.deleteMany({
    // Conversations turned into support requests are kept with the request.
    where: { lastMessageAt: { lte: new Date(now.getTime() - CONVERSATION_RETENTION_MS) }, supportRequestId: null },
  })
  return count
}
