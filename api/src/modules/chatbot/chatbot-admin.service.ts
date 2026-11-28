import { isDeepStrictEqual } from 'node:util'
import {
  ErrorCode,
  type AdminChatConversation,
  type AdminChatConversationPage,
  type AdminChatConversationQuery,
  type ChatbotModelStatus,
  type ChatbotReport,
  type ChatbotSettings,
} from '@ecommerce/shared'
import type { z } from 'zod'
import type { LlmClient } from '../../core/adapters/llm.ts'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { AppError } from '../../core/errors.ts'
import { isUuid } from '../../core/middleware/validation.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { startOfDay, type Period } from '../report/index.ts'
import { readChatbotSettings, toMessageView } from './chatbot-conversation.ts'
import { chatbotReport } from './chatbot-report.ts'
import type { ChatbotRepository } from './chatbot.repository.ts'

const DAY_MS = 24 * 60 * 60_000
const FIRST_QUESTION_LENGTH = 120

/** Admin chatbot pages (spec M8). Conversations carry no IP (only stored hashed, never returned). */
export class ChatbotAdminService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: ChatbotRepository,
    private readonly llm: LlmClient | undefined,
  ) {}

  settings(): Promise<ChatbotSettings> {
    return readChatbotSettings(this.prisma)
  }

  /** Saves under a lock; no change, no write. */
  saveSettings(after: ChatbotSettings, ctx: RequestContext): Promise<ChatbotSettings> {
    return audited(this.prisma, ctx, async (tx, audit) => {
      await this.repo.lockSettings(tx)
      const before = await readChatbotSettings(tx)
      if (isDeepStrictEqual(before, after)) return before
      await this.repo.saveSettings(tx, after)
      await audit({ action: 'chatbot.settings.update', entityType: 'chatbot', entityId: 'chatbot', before, after })
      return after
    })
  }

  /** State lives in the memory of the answering API process (ADR 0017); with several instances each has its own. */
  status(): ChatbotModelStatus {
    return {
      configured: this.llm !== undefined,
      models: (this.llm?.status() ?? []).map(({ model, exhaustedUntil }) => ({
        model,
        exhaustedUntil: exhaustedUntil?.toISOString() ?? null,
      })),
    }
  }

  async conversations(query: z.output<typeof AdminChatConversationQuery>): Promise<AdminChatConversationPage> {
    const lastMessageAt: Prisma.DateTimeFilter = {
      ...(query.from && { gte: startOfDay(query.from) }),
      ...(query.to && { lt: new Date(startOfDay(query.to).getTime() + DAY_MS) }),
    }
    const where: Prisma.ChatConversationWhereInput = {
      ...((query.from || query.to) && { lastMessageAt }),
      ...(query.handedOff !== undefined && { supportRequestId: query.handedOff ? { not: null } : null }),
      ...(query.failed && { messages: { some: { error: { not: null } } } }),
    }
    const { rows, total } = await this.repo.page(this.prisma, where, query)
    return {
      items: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        lastMessageAt: row.lastMessageAt.toISOString(),
        customerMessageCount: row.customerMessageCount,
        firstQuestion: (row.messages[0]?.content ?? '').slice(0, FIRST_QUESTION_LENGTH),
        failedTurns: row._count.messages,
        supportRequestCode: row.supportRequest?.code ?? null,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    }
  }

  async conversation(id: string): Promise<AdminChatConversation> {
    const conversation = isUuid(id) ? await this.repo.findWithMessages(this.prisma, id) : null
    if (!conversation) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy cuộc trò chuyện')
    return {
      id: conversation.id,
      createdAt: conversation.createdAt.toISOString(),
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      supportRequestCode: conversation.supportRequest?.code ?? null,
      messages: conversation.messages.map((message) => ({
        ...toMessageView(message),
        model: message.model,
        promptVersion: message.promptVersion,
        error: message.error,
        handoffSummary: message.handoffSummary,
      })),
    }
  }

  report(period: Period): Promise<ChatbotReport> {
    return chatbotReport(this.prisma, period)
  }
}
