import { Router } from 'express'
import {
  CHAT_PRIVACY_NOTICE,
  ChatHandoffRequest,
  ChatMessageRequest,
  ErrorCode,
  type ChatHandoffResponse,
  type ChatConversationView,
  type ChatStatus,
  type ChatTurnResponse,
} from '@ecommerce/shared'
import type { LlmClient } from '../adapters/llm.ts'
import type { Storage } from '../adapters/storage.ts'
import type { AppDeps } from '../app.ts'
import { hashOpaqueToken } from '../auth/opaque-token.ts'
import { optionalAuth } from '../auth/require-auth.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { createSupportRequest, findSupportCustomer } from '../support/support.ts'
import {
  appendCustomerMessage,
  conversationView,
  readChatbotSettings,
  recordUsage,
  toMessageView,
  unavailableReason,
} from '../chat/chat.ts'
import { PROMPT_VERSION, promptMessages } from '../chat/prompt.ts'
import { asksForStaff } from '../chat/intent.ts'
import { policySlugs, productForModel } from '../chat/tools.ts'
import { TurnFailedError, runTurn } from '../chat/turn.ts'
import { findPublicProduct } from '../catalog/public-products.ts'
import type { Db } from '../db.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { isUuid, parse } from '../http/validation.ts'

/** Tiêu đề yêu cầu khi chatbot chưa tóm tắt được (khách bấm "Gặp nhân viên" trước khi hỏi gì). */
const HANDOFF_SUBJECT = 'Khách cần nhân viên hỗ trợ (từ trợ lý tư vấn)'
const HANDOFF_SUBJECT_MAX = 120
const HANDOFF_MESSAGE = 'Khách chuyển từ trợ lý tư vấn, không ghi thêm lời nhắn. Xem cuộc trò chuyện bên dưới.'

type Deps = Pick<AppDeps, 'prisma' | 'logger' | 'storage' | 'emails' | 'siteUrl'> & {
  llm?: LlmClient
  /** Khóa ký access token, để nhận ra khách đã đăng nhập khi chuyển nhân viên. */
  secret: Uint8Array
}

/** Chatbot cho khách (spec M8): không cần đăng nhập; ai có mã cuộc trò chuyện thì đọc được cuộc đó. */
export function chatRoutes({ prisma, logger, storage, llm, emails, siteUrl, secret }: Deps) {
  return (
    Router()
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
          const result = await runTurn(
            llm,
            { prisma, storage },
            promptMessages(turn.history, viewing, await policySlugs(prisma)),
          )
          // Không ghi nội dung khách gõ; công cụ và tham số đủ để biết vì sao chatbot trả lời như vậy.
          logger.info(
            { conversationId: turn.conversationId, model: result.model, tools: result.tools },
            'Chatbot đã trả lời',
          )
          // Model đề nghị chuyển, hay khách tự đòi gặp nhân viên (`asksForStaff`): tóm tắt làm tiêu đề yêu cầu (ticket 05).
          const handoffSummary =
            result.handoffSummary ?? (asksForStaff(input.content) ? input.content.slice(0, HANDOFF_SUBJECT_MAX) : null)
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
                handoffSummary,
                createdAt: answeredAt,
              },
            })
          })
          const body: ChatTurnResponse = {
            conversationId: turn.conversationId,
            outcome: 'answered',
            reply: toMessageView(reply),
            cards: result.cards,
            handoffSuggested: handoffSummary !== null,
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
      // Khách xác nhận chuyển nhân viên (spec M8, ticket 05): tạo yêu cầu hỗ trợ loại "khác" do chatbot tạo. Không qua
      // model; có cuộc trò chuyện thì gắn vào yêu cầu để nhân viên đọc bản chép.
      .post('/handoff', optionalAuth(secret, 'customer'), async (req, res) => {
        const input = parse(ChatHandoffRequest, req.body)
        const customer = req.auth ? await findSupportCustomer(prisma, { id: req.auth.subjectId }) : null
        if (!customer) {
          if (!input.name) throw invalidField('name', 'Nhập tên để nhân viên xưng hô')
          if (!input.email) throw invalidField('email', 'Nhập email để nhận trả lời')
        }
        const conversation = input.conversationId
          ? await prisma.chatConversation.findUnique({ where: { id: input.conversationId } })
          : null
        if (input.conversationId && !conversation)
          throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy cuộc trò chuyện')
        if (!conversation && !input.message) throw invalidField('message', 'Nhập điều bạn cần nhân viên hỗ trợ')
        const suggested = conversation
          ? await prisma.chatMessage.findFirst({
              where: { conversationId: conversation.id, handoffSummary: { not: null } },
              orderBy: { createdAt: 'desc' },
              select: { handoffSummary: true },
            })
          : null
        const subject = (suggested?.handoffSummary ?? HANDOFF_SUBJECT).slice(0, HANDOFF_SUBJECT_MAX).trim()
        const request = await prisma.$transaction(async (tx) => {
          const created = await createSupportRequest(
            tx,
            { emails, siteUrl },
            {
              kind: 'other',
              subject: subject || HANDOFF_SUBJECT,
              message: input.message || HANDOFF_MESSAGE,
              creator: { type: 'chatbot' },
              ...(customer ? { customer } : { contact: { name: input.name!, email: input.email! } }),
            },
          )
          if (conversation) {
            // Điều kiện "chưa chuyển" nằm trong câu UPDATE: hai lần bấm cùng lúc thì lần sau rollback cả yêu cầu vừa tạo.
            const { count } = await tx.chatConversation.updateMany({
              where: { id: conversation.id, supportRequestId: null },
              data: { supportRequestId: created.id },
            })
            if (count === 0)
              throw new AppError(409, ErrorCode.CONFLICT, 'Cuộc trò chuyện này đã được chuyển cho nhân viên')
          }
          // Đếm trong cùng transaction, sau khi đã tạo được: lần bị 400 hay 409 rollback cả bộ đếm, nên không mất lượt
          // chuyển trong ngày; quá giới hạn thì 429 rollback cả yêu cầu vừa tạo.
          await enforceRateLimits(
            tx,
            res,
            [{ limit: RATE_LIMITS.chatHandoffPerIp, subject: req.ip ?? 'unknown' }],
            'Bạn đã gửi nhiều yêu cầu hôm nay; nhân viên sẽ trả lời các yêu cầu đã gửi',
          )
          return created
        })
        const settings = await readChatbotSettings(prisma)
        const body: ChatHandoffResponse = {
          requestCode: request.code,
          responseTimeNote: settings.responseTimeNote,
          link: customer ? `/tai-khoan/yeu-cau/${request.code}` : null,
        }
        res.status(201).json(body)
      })
      .get('/conversations/:id', async (req, res) => {
        const id = String(req.params.id)
        const body: ChatConversationView = await conversationView(
          prisma,
          isUuid(id) ? id : '00000000-0000-0000-0000-000000000000',
        )
        res.json(body)
      })
  )
}

/** Sản phẩm khách đang xem, để khách hỏi "cái này" (spec M8). Slug không có hay chưa xuất bản thì bỏ qua. */
async function viewingProduct(prisma: Db, storage: Storage, slug: string | undefined) {
  const product = slug ? await findPublicProduct(prisma, storage, slug) : null
  return product ? { slug: product.slug, product: productForModel(product) } : undefined
}
