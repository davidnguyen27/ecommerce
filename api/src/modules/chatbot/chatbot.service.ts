import {
  CHAT_PRIVACY_NOTICE,
  ErrorCode,
  type ChatConversationView,
  type ChatHandoffRequest,
  type ChatHandoffResponse,
  type ChatMessageRequest,
  type ChatStatus,
  type ChatTurnResponse,
} from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { LlmClient } from '../../core/adapters/llm.ts'
import type { Storage } from '../../core/adapters/storage.ts'
import { hashOpaqueToken } from '../../core/auth/opaque-token.ts'
import type { Db } from '../../core/db.ts'
import { AppError, invalidField } from '../../core/errors.ts'
import type { CustomerMail } from '../../core/jobs/jobs.ts'
import { RATE_LIMITS, enforceRateLimits } from '../../core/middleware/rate-limit.ts'
import { isUuid } from '../../core/middleware/validation.ts'
import type { IProductQuery } from '../product/index.ts'
import { createSupportRequest, findSupportCustomer } from '../support/index.ts'
import {
  appendCustomerMessage,
  conversationView,
  readChatbotSettings,
  recordUsage,
  toMessageView,
  unavailableReason,
} from './chatbot-conversation.ts'
import { asksForStaff, dropSentClaims, looksEnglish, relativeShopLinks, stripToolLabels } from './chatbot-intent.ts'
import { PROMPT_VERSION, promptMessages } from './chatbot-prompt.ts'
import { policySlugs, productForModel } from './chatbot-tools.ts'
import { TurnFailedError, runTurn } from './chatbot-turn.ts'
import type { ChatbotRepository } from './chatbot.repository.ts'

/** Request title when the chatbot has nothing to summarize (the customer pressed "Gặp nhân viên" before asking). */
const HANDOFF_SUBJECT = 'Khách cần nhân viên hỗ trợ (từ trợ lý tư vấn)'
const HANDOFF_SUBJECT_MAX = 120
const HANDOFF_MESSAGE = 'Khách chuyển từ trợ lý tư vấn, không ghi thêm lời nhắn. Xem cuộc trò chuyện bên dưới.'

/** Customer chatbot (spec M8): no sign-in; anyone with the conversation id can read it. */
export class ChatbotService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: ChatbotRepository,
    private readonly storage: Storage,
    private readonly llm: LlmClient | undefined,
    private readonly mail: CustomerMail,
    private readonly logger: Logger,
    private readonly products: Pick<IProductQuery, 'findPublicProduct'>,
  ) {}

  async status(): Promise<ChatStatus> {
    const reason = unavailableReason(await readChatbotSettings(this.prisma), this.llm)
    return { available: reason === null, reason, privacyNotice: CHAT_PRIVACY_NOTICE }
  }

  /** One customer turn: store the question, ask the model outside any transaction, store the answer or the failure. */
  async message(input: ChatMessageRequest, ip: string): Promise<ChatTurnResponse> {
    const { prisma, llm, logger } = this
    await enforceRateLimits(
      prisma,
      [{ limit: RATE_LIMITS.chatMessagePerIp, subject: ip }],
      'Bạn gửi quá nhiều câu hỏi, vui lòng thử lại sau',
    )
    const reason = unavailableReason(await readChatbotSettings(prisma), llm)
    // Off or no keys: store nothing. Out of quota: still store the message, so reports count how often customers hit
    // it.
    if (!llm || reason === 'disabled' || reason === 'unconfigured') {
      return {
        conversationId: null,
        outcome: reason ?? 'unconfigured',
        reply: null,
        cards: [],
        handoffSuggested: false,
      }
    }

    const turn = await prisma.$transaction((tx) =>
      appendCustomerMessage(
        tx,
        { conversationId: input.conversationId, content: input.content, ipHash: hashOpaqueToken(ip) },
        new Date(),
      ),
    )
    const viewing = await this.viewingProduct(input.viewingProductSlug)
    // Call the model outside the transaction: a turn can take tens of seconds.
    try {
      const result = await runTurn(
        llm,
        { prisma, storage: this.storage },
        promptMessages(turn.history, viewing, await policySlugs(prisma)),
      )
      // Do not log what the customer typed; tools and arguments are enough to explain the answer.
      logger.info(
        { conversationId: turn.conversationId, model: result.model, tools: result.tools },
        'Chatbot đã trả lời',
      )
      const unlabeled = relativeShopLinks(stripToolLabels(result.content))
      const content = dropSentClaims(unlabeled, looksEnglish(input.content))
      // The model offered handoff, talked about it (`dropSentClaims` just removed a "sent" sentence), or the customer
      // asked for staff (`asksForStaff`): summarize as the request title (ticket 05).
      const handoffSummary =
        result.handoffSummary ??
        (asksForStaff(input.content) || content !== unlabeled ? input.content.slice(0, HANDOFF_SUBJECT_MAX) : null)
      const answeredAt = new Date()
      const reply = await prisma.$transaction(async (tx) => {
        for (const call of result.calls) await recordUsage(tx, call.attempts, call.usage, answeredAt)
        return this.repo.saveReply(tx, {
          conversationId: turn.conversationId,
          role: 'assistant',
          content,
          model: result.model,
          promptVersion: PROMPT_VERSION,
          products: result.cards.map((card) => ({ slug: card.slug, name: card.name })),
          handoffSummary,
          createdAt: answeredAt,
        })
      })
      return {
        conversationId: turn.conversationId,
        outcome: 'answered',
        reply: toMessageView(reply),
        cards: result.cards,
        handoffSuggested: handoffSummary !== null,
      }
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
        await this.repo.markFailed(tx, turn.message.id, failure)
      })
      return { conversationId: turn.conversationId, outcome: failure, reply: null, cards: [], handoffSuggested: false }
    }
  }

  /**
   * The customer confirms the handoff (spec M8, ticket 05): creates an "other" support request by the chatbot. No model
   * call; an existing conversation is attached so staff can read the transcript.
   */
  async handoff(input: ChatHandoffRequest, customerId: string | null, ip: string): Promise<ChatHandoffResponse> {
    const { prisma } = this
    const customer = customerId ? await findSupportCustomer(prisma, { id: customerId }) : null
    if (!customer) {
      if (!input.name) throw invalidField('name', 'Nhập tên để nhân viên xưng hô')
      if (!input.email) throw invalidField('email', 'Nhập email để nhận trả lời')
    }
    const conversation = input.conversationId ? await this.repo.findConversation(prisma, input.conversationId) : null
    if (input.conversationId && !conversation)
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy cuộc trò chuyện')
    if (!conversation && !input.message) throw invalidField('message', 'Nhập điều bạn cần nhân viên hỗ trợ')
    const suggested = conversation ? await this.repo.latestHandoffSummary(prisma, conversation.id) : null
    const subject = (suggested?.handoffSummary ?? HANDOFF_SUBJECT).slice(0, HANDOFF_SUBJECT_MAX).trim()
    const request = await prisma.$transaction(async (tx) => {
      const created = await createSupportRequest(tx, this.mail, {
        kind: 'other',
        subject: subject || HANDOFF_SUBJECT,
        message: input.message || HANDOFF_MESSAGE,
        creator: { type: 'chatbot' },
        ...(customer ? { customer } : { contact: { name: input.name!, email: input.email! } }),
      })
      // Of two concurrent clicks the second rolls back its new request.
      if (conversation && !(await this.repo.attachRequest(tx, conversation.id, created.id)))
        throw new AppError(409, ErrorCode.CONFLICT, 'Cuộc trò chuyện này đã được chuyển cho nhân viên')
      // Counted in the same transaction after creation: a 400 or 409 rolls back the counter, so no daily handoff is
      // lost; over the limit, the 429 rolls back the new request.
      await enforceRateLimits(
        tx,
        [{ limit: RATE_LIMITS.chatHandoffPerIp, subject: ip }],
        'Bạn đã gửi nhiều yêu cầu hôm nay; nhân viên sẽ trả lời các yêu cầu đã gửi',
      )
      return created
    })
    const settings = await readChatbotSettings(prisma)
    return {
      requestCode: request.code,
      responseTimeNote: settings.responseTimeNote,
      link: customer ? `/tai-khoan/yeu-cau/${request.code}` : null,
    }
  }

  /** A malformed id reads as a missing conversation. */
  conversation(id: string): Promise<ChatConversationView> {
    return conversationView(this.prisma, isUuid(id) ? id : '00000000-0000-0000-0000-000000000000')
  }

  /**
   * The product being viewed, so customers can ask about "cái này" (spec M8). Unknown or unpublished slugs are
   * ignored.
   */
  private async viewingProduct(slug: string | undefined) {
    const product = slug ? await this.products.findPublicProduct(slug) : null
    return product ? { slug: product.slug, product: productForModel(product) } : undefined
  }
}
