import type { ChatbotSettings } from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

/** Conversations, messages and settings outside the turn bookkeeping in `chatbot-conversation.ts`. Every method takes `db`. */
export class ChatbotRepository {
  // ===== Settings =====

  /** Serializes edits, so the second of two concurrent edits sees exactly what the first wrote. */
  async lockSettings(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('chatbot_setting'))`
  }

  async saveSettings(db: DbClient, settings: ChatbotSettings) {
    await db.chatbotSetting.upsert({ where: { id: true }, create: settings, update: settings })
  }

  // ===== Customer turns and handoff =====

  /** The assistant's reply, after the model answered, with the conversation's last activity. */
  async saveReply(db: DbClient, data: Prisma.ChatMessageUncheckedCreateInput & { createdAt: Date }) {
    await db.chatConversation.update({ where: { id: data.conversationId }, data: { lastMessageAt: data.createdAt } })
    return db.chatMessage.create({ data })
  }

  async markFailed(db: DbClient, messageId: string, error: string) {
    await db.chatMessage.update({ where: { id: messageId }, data: { error } })
  }

  findConversation(db: DbClient, id: string) {
    return db.chatConversation.findUnique({ where: { id } })
  }

  /** The latest summary the model (or the intent check) proposed as the request title. */
  latestHandoffSummary(db: DbClient, conversationId: string) {
    return db.chatMessage.findFirst({
      where: { conversationId, handoffSummary: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { handoffSummary: true },
    })
  }

  /**
   * Links the conversation to its support request; the "not handed off yet" condition is in the UPDATE, so of two
   * concurrent handoffs only one succeeds. Returns whether it did.
   */
  async attachRequest(db: DbClient, conversationId: string, supportRequestId: string) {
    const { count } = await db.chatConversation.updateMany({
      where: { id: conversationId, supportRequestId: null },
      data: { supportRequestId },
    })
    return count > 0
  }

  // ===== Admin =====

  async page(db: DbClient, where: Prisma.ChatConversationWhereInput, window: { page: number; pageSize: number }) {
    const [rows, total] = await Promise.all([
      db.chatConversation.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
        skip: (window.page - 1) * window.pageSize,
        take: window.pageSize,
        include: {
          supportRequest: { select: { code: true } },
          messages: {
            where: { role: 'customer' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { content: true },
          },
          _count: { select: { messages: { where: { error: { not: null } } } } },
        },
      }),
      db.chatConversation.count({ where }),
    ])
    return { rows, total }
  }

  findWithMessages(db: DbClient, id: string) {
    return db.chatConversation.findUnique({
      where: { id },
      include: { supportRequest: { select: { code: true } }, messages: { orderBy: { createdAt: 'asc' } } },
    })
  }
}
