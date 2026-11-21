import { isDeepStrictEqual } from 'node:util'
import { Router } from 'express'
import {
  AdminChatConversationQuery,
  ChatbotSettings,
  ErrorCode,
  ReportQuery,
  type ChatbotReport,
  type AdminChatConversation,
  type AdminChatConversationPage,
  type ChatbotModelStatus,
} from '@ecommerce/shared'
import type { LlmClient } from '../adapters/llm.ts'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import { readChatbotSettings, toMessageView } from '../chat/chat.ts'
import type { Db } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { isUuid, parse } from '../http/validation.ts'
import { chatbotReport } from '../reports/chatbot.ts'
import { periodOf, startOfDay } from '../reports/period.ts'

const DAY_MS = 24 * 60 * 60_000
const FIRST_QUESTION_LENGTH = 120

/**
 * Chatbot ở trang quản trị (spec M8): quyền `chatbot.manage`, mặc định chỉ owner. Cuộc trò chuyện không kèm IP (chỉ
 * lưu dạng băm, không trả ra).
 */
export function adminChatbotRoutes(prisma: Db, llm: LlmClient | undefined) {
  return (
    Router()
      .use(requirePermission('chatbot.manage'))
      .get('/settings', async (_req, res) => {
        const body: ChatbotSettings = await readChatbotSettings(prisma)
        res.json(body)
      })
      .put('/settings', async (req, res) => {
        const after = parse(ChatbotSettings, req.body)
        const body: ChatbotSettings = await audited(prisma, req, async (tx, audit) => {
          // Hai lần sửa cùng lúc thì `before` của lần sau là đúng bản lần trước đã ghi.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('chatbot_setting'))`
          const before = await readChatbotSettings(tx)
          if (isDeepStrictEqual(before, after)) return before
          await tx.chatbotSetting.upsert({ where: { id: true }, create: after, update: after })
          await audit({ action: 'chatbot.settings.update', entityType: 'chatbot', entityId: 'chatbot', before, after })
          return after
        })
        res.json(body)
      })
      // Trạng thái nằm trong bộ nhớ của process API đang trả lời (ADR 0017); nhiều instance thì mỗi instance một trạng thái.
      .get('/status', (_req, res) => {
        const body: ChatbotModelStatus = {
          configured: llm !== undefined,
          models: (llm?.status() ?? []).map(({ model, exhaustedUntil }) => ({
            model,
            exhaustedUntil: exhaustedUntil?.toISOString() ?? null,
          })),
        }
        res.json(body)
      })
      .get('/conversations', async (req, res) => {
        const query = parse(AdminChatConversationQuery, req.query)
        const lastMessageAt: Prisma.DateTimeFilter = {
          ...(query.from && { gte: startOfDay(query.from) }),
          ...(query.to && { lt: new Date(startOfDay(query.to).getTime() + DAY_MS) }),
        }
        const where: Prisma.ChatConversationWhereInput = {
          ...((query.from || query.to) && { lastMessageAt }),
          ...(query.handedOff !== undefined && { supportRequestId: query.handedOff ? { not: null } : null }),
          ...(query.failed && { messages: { some: { error: { not: null } } } }),
        }
        const [rows, total] = await Promise.all([
          prisma.chatConversation.findMany({
            where,
            orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
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
          prisma.chatConversation.count({ where }),
        ])
        const body: AdminChatConversationPage = {
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
        res.json(body)
      })
      .get('/conversations/:id', async (req, res) => {
        const id = String(req.params.id)
        const conversation = isUuid(id)
          ? await prisma.chatConversation.findUnique({
              where: { id },
              include: { supportRequest: { select: { code: true } }, messages: { orderBy: { createdAt: 'asc' } } },
            })
          : null
        if (!conversation) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy cuộc trò chuyện')
        const body: AdminChatConversation = {
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
        res.json(body)
      })
  )
}

/**
 * Báo cáo chatbot (spec M8), mount tại `/reports/chatbot` trước router báo cáo M7: dùng quyền `chatbot.manage` thay cho
 * `report.view`, nên người chỉ có `chatbot.manage` vẫn xem được.
 */
export function adminChatbotReportRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('chatbot.manage'))
    .get('/', async (req, res) => {
      const body: ChatbotReport = await chatbotReport(prisma, periodOf(parse(ReportQuery, req.query)))
      res.json(body)
    })
}
