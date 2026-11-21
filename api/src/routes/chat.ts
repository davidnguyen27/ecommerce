import { Router } from 'express'
import {
  CHAT_PRIVACY_NOTICE,
  ChatMessageRequest,
  type ChatConversationView,
  type ChatStatus,
  type ChatTurnResponse,
} from '@ecommerce/shared'
import type { LlmClient } from '../adapters/llm.ts'
import type { Storage } from '../adapters/storage.ts'
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
import { productForModel } from '../chat/tools.ts'
import { TurnFailedError, runTurn } from '../chat/turn.ts'
import { findPublicProduct } from '../catalog/public-products.ts'
import type { Db } from '../db.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { parse } from '../http/validation.ts'

type Deps = Pick<AppDeps, 'prisma' | 'logger' | 'storage'> & { llm?: LlmClient }

/** Chatbot cho khách (spec M8): không cần đăng nhập; ai có mã cuộc trò chuyện thì đọc được cuộc đó. */
export function chatRoutes({ prisma, logger, storage, llm }: Deps) {
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
        const body: ChatTurnResponse = {
          conversationId: null,
          outcome: reason ?? 'unconfigured',
          reply: null,
          cards: [],
          handoffSuggested: false,
        }
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
      const viewing = await viewingProduct(prisma, storage, input.viewingProductSlug)
      // Gọi model ngoài transaction: một lượt có thể mất tới vài chục giây.
      try {
        const result = await runTurn(llm, { prisma, storage }, promptMessages(turn.history, viewing))
        // Không ghi nội dung khách gõ; công cụ và tham số đủ để biết vì sao chatbot trả lời như vậy.
        logger.info(
          { conversationId: turn.conversationId, model: result.model, tools: result.tools },
          'Chatbot đã trả lời',
        )
        const answeredAt = new Date()
        const reply = await prisma.$transaction(async (tx) => {
          for (const call of result.calls) await recordUsage(tx, call.attempts, call.usage, answeredAt)
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
              products: result.cards.map((card) => ({ slug: card.slug, name: card.name })),
              handoffSummary: result.handoffSummary,
              createdAt: answeredAt,
            },
          })
        })
        const body: ChatTurnResponse = {
          conversationId: turn.conversationId,
          outcome: 'answered',
          reply: toMessageView(reply),
          cards: result.cards,
          handoffSuggested: result.handoffSummary !== null,
        }
        res.json(body)
      } catch (error) {
        const failure = error instanceof TurnFailedError ? error.reason : 'failed'
        const calls = error instanceof TurnFailedError ? error.calls : []
        logger.warn(
          { err: error instanceof TurnFailedError ? error.cause : error, attempts: calls.flatMap((c) => c.attempts) },
          'Chatbot không trả lời được',
        )
        const failedAt = new Date()
        await prisma.$transaction(async (tx) => {
          for (const call of calls) await recordUsage(tx, call.attempts, call.usage, failedAt)
          await tx.chatMessage.update({ where: { id: turn.message.id }, data: { error: failure } })
        })
        const body: ChatTurnResponse = {
          conversationId: turn.conversationId,
          outcome: failure,
          reply: null,
          cards: [],
          handoffSuggested: false,
        }
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

/** Sản phẩm khách đang xem, để khách hỏi "cái này" (spec M8). Slug không có hay chưa xuất bản thì bỏ qua. */
async function viewingProduct(prisma: Db, storage: Storage, slug: string | undefined) {
  const product = slug ? await findPublicProduct(prisma, storage, slug) : null
  return product ? { slug: product.slug, product: productForModel(product) } : undefined
}
