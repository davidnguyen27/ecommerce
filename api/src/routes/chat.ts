import { Router } from 'express'
import {
  CHAT_PRIVACY_NOTICE,
  ChatMessageRequest,
  type ChatConversationView,
  type ChatStatus,
  type ChatTurnResponse,
} from '@ecommerce/shared'
import { LlmUnavailableError, type LlmClient } from '../adapters/llm.ts'
import type { AppDeps } from '../app.ts'
import { hashOpaqueToken } from '../auth/opaque-token.ts'
import {
  appendCustomerMessage,
  conversationView,
  readChatbotSettings,
  recordUsage,
  toMessageView,
  unavailableReason,
} from '../chat/chat.ts'
import { PROMPT_VERSION, promptMessages } from '../chat/prompt.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { parse } from '../http/validation.ts'

type Deps = Pick<AppDeps, 'prisma' | 'logger'> & { llm?: LlmClient }

/** Chatbot cho khách (spec M8): không cần đăng nhập; ai có mã cuộc trò chuyện thì đọc được cuộc đó. */
export function chatRoutes({ prisma, logger, llm }: Deps) {
  return Router()
    .get('/status', async (_req, res) => {
      const reason = unavailableReason(await readChatbotSettings(prisma), llm)
      const body: ChatStatus = { available: reason === null, reason, privacyNotice: CHAT_PRIVACY_NOTICE }
      res.json(body)
    })
    .post('/messages', async (req, res) => {
      const input = parse(ChatMessageRequest, req.body)
      const ip = req.ip ?? 'unknown'
      await enforceRateLimits(
        prisma,
        res,
        [{ limit: RATE_LIMITS.chatMessagePerIp, subject: ip }],
        'Bạn gửi quá nhiều câu hỏi, vui lòng thử lại sau',
      )
      const reason = unavailableReason(await readChatbotSettings(prisma), llm)
      // Tắt hay chưa có khóa thì không lưu gì. Hết lượt thì vẫn lưu tin, để báo cáo đếm được số lần khách bị báo hết lượt.
      if (!llm || reason === 'disabled' || reason === 'unconfigured') {
        const body: ChatTurnResponse = { conversationId: null, outcome: reason ?? 'unconfigured', reply: null }
        res.json(body)
        return
      }

      const turn = await prisma.$transaction((tx) =>
        appendCustomerMessage(
          tx,
          { conversationId: input.conversationId, content: input.content, ipHash: hashOpaqueToken(ip) },
          new Date(),
        ),
      )
      // Gọi model ngoài transaction: một lượt có thể mất tới vài chục giây.
      try {
        const result = await llm.complete({ messages: promptMessages(turn.history) })
        const answeredAt = new Date()
        const reply = await prisma.$transaction(async (tx) => {
          await recordUsage(tx, result.attempts, { model: result.model, ...result.usage }, answeredAt)
          await tx.chatConversation.update({
            where: { id: turn.conversationId },
            data: { lastMessageAt: answeredAt },
          })
          return tx.chatMessage.create({
            data: {
              conversationId: turn.conversationId,
              role: 'assistant',
              content: result.content,
              model: result.model,
              promptVersion: PROMPT_VERSION,
              createdAt: answeredAt,
            },
          })
        })
        const body: ChatTurnResponse = {
          conversationId: turn.conversationId,
          outcome: 'answered',
          reply: toMessageView(reply),
        }
        res.json(body)
      } catch (error) {
        const failure = error instanceof LlmUnavailableError ? error.reason : 'failed'
        logger.warn(
          { err: error, attempts: error instanceof LlmUnavailableError ? error.attempts : undefined },
          'Chatbot không trả lời được',
        )
        await prisma.$transaction(async (tx) => {
          if (error instanceof LlmUnavailableError) await recordUsage(tx, error.attempts, null, new Date())
          await tx.chatMessage.update({ where: { id: turn.message.id }, data: { error: failure } })
        })
        const body: ChatTurnResponse = { conversationId: turn.conversationId, outcome: failure, reply: null }
        res.json(body)
      }
    })
    .get('/conversations/:id', async (req, res) => {
      const id = String(req.params.id)
      const body: ChatConversationView = await conversationView(prisma, parseUuid(id))
      res.json(body)
    })
}

/** Mã không phải uuid thì coi như không thấy, thay vì để Postgres báo lỗi kiểu. */
function parseUuid(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id
    : '00000000-0000-0000-0000-000000000000'
}
