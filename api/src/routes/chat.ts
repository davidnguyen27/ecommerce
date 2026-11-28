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
import type { LlmClient } from '../core/adapters/llm.ts'
import type { Storage } from '../core/adapters/storage.ts'
import type { AppDeps } from '../app.ts'
import { hashOpaqueToken } from '../core/auth/opaque-token.ts'
import { optionalAuth } from '../core/middleware/require-auth.ts'
import { AppError, invalidField } from '../core/errors.ts'
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
import { asksForStaff, dropSentClaims, looksEnglish, relativeShopLinks, stripToolLabels } from '../chat/intent.ts'
import { policySlugs, productForModel } from '../chat/tools.ts'
import { TurnFailedError, runTurn } from '../chat/turn.ts'
import { attributeSchemaQuery } from '../modules/attribute-schema/index.ts'
import { categoryQuery } from '../modules/category/index.ts'
import { createProductQuery } from '../modules/product/index.ts'
import type { Db } from '../core/db.ts'
import { RATE_LIMITS, enforceRateLimits } from '../core/middleware/rate-limit.ts'
import { isUuid, parse } from '../core/middleware/validation.ts'

/** Customer product reads; the chatbot has no module wiring yet (ticket 09). */
const productsOf = (prisma: Db, storage: Storage) =>
  createProductQuery({ prisma, storage }, { schemas: attributeSchemaQuery, categories: categoryQuery })

/** Request title when the chatbot has nothing to summarize (the customer pressed "Gặp nhân viên" before asking). */
const HANDOFF_SUBJECT = 'Khách cần nhân viên hỗ trợ (từ trợ lý tư vấn)'
const HANDOFF_SUBJECT_MAX = 120
const HANDOFF_MESSAGE = 'Khách chuyển từ trợ lý tư vấn, không ghi thêm lời nhắn. Xem cuộc trò chuyện bên dưới.'

type Deps = Pick<AppDeps, 'prisma' | 'logger' | 'storage' | 'emails' | 'siteUrl'> & {
  llm?: LlmClient
  /** Access token signing key, to recognize signed-in customers on handoff. */
  secret: Uint8Array
}

/** Customer chatbot (spec M8): no sign-in; anyone with the conversation id can read it. */
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
          [{ limit: RATE_LIMITS.chatMessagePerIp, subject: ip }],
          'Bạn gửi quá nhiều câu hỏi, vui lòng thử lại sau',
        )
        const reason = unavailableReason(await readChatbotSettings(prisma), llm)
        // Off or no keys: store nothing. Out of quota: still store the message, so reports count how often customers
        // hit it.
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
        // Call the model outside the transaction: a turn can take tens of seconds.
        try {
          const result = await runTurn(
            llm,
            { prisma, storage },
            promptMessages(turn.history, viewing, await policySlugs(prisma)),
          )
          // Do not log what the customer typed; tools and arguments are enough to explain the answer.
          logger.info(
            { conversationId: turn.conversationId, model: result.model, tools: result.tools },
            'Chatbot đã trả lời',
          )
          const unlabeled = relativeShopLinks(stripToolLabels(result.content))
          const content = dropSentClaims(unlabeled, looksEnglish(input.content))
          // The model offered handoff, talked about it (`dropSentClaims` just removed a "sent" sentence), or the
          // customer asked for staff (`asksForStaff`): summarize as the request title (ticket 05).
          const handoffSummary =
            result.handoffSummary ??
            (asksForStaff(input.content) || content !== unlabeled ? input.content.slice(0, HANDOFF_SUBJECT_MAX) : null)
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
                content,
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
      // The customer confirms the handoff (spec M8, ticket 05): creates an "other" support request by the chatbot. No
      // model call; an existing conversation is attached so staff can read the transcript.
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
            // The "not handed off yet" condition is in the UPDATE: of two concurrent clicks the second rolls back its
            // new request.
            const { count } = await tx.chatConversation.updateMany({
              where: { id: conversation.id, supportRequestId: null },
              data: { supportRequestId: created.id },
            })
            if (count === 0)
              throw new AppError(409, ErrorCode.CONFLICT, 'Cuộc trò chuyện này đã được chuyển cho nhân viên')
          }
          // Counted in the same transaction after creation: a 400 or 409 rolls back the counter, so no daily handoff is
          // lost; over the limit, the 429 rolls back the new request.
          await enforceRateLimits(
            tx,
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

/**
 * The product being viewed, so customers can ask about "cái này" (spec M8). Unknown or unpublished slugs are ignored.
 */
async function viewingProduct(prisma: Db, storage: Storage, slug: string | undefined) {
  const product = slug ? await productsOf(prisma, storage).findPublicProduct(slug) : null
  return product ? { slug: product.slug, product: productForModel(product) } : undefined
}
