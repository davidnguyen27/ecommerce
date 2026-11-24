import { z } from 'zod'
import { PageQuery, pageOf } from './pagination.ts'
import { ProductCard } from './products.ts'

/** Max length of a customer message (spec M8, provisional). */
export const CHAT_MESSAGE_MAX_LENGTH = 500
/** Max customer messages per conversation (spec M8, provisional). */
export const CHAT_MESSAGES_PER_CONVERSATION = 30

/** Line shown at the top of the chat (spec M8 "Web"); the privacy policy explains in detail. */
export const CHAT_PRIVACY_NOTICE =
  'Cuộc trò chuyện được lưu 90 ngày và xử lý bởi nhà cung cấp AI bên ngoài; đừng nhập thông tin nhạy cảm.'

/**
 * Why the chatbot cannot answer: the owner turned it off, the server has no model key, or every model is out of quota
 * (ADR 0017). `null` means it can answer.
 */
export const ChatUnavailableReason = z.enum(['disabled', 'unconfigured', 'exhausted'])
export type ChatUnavailableReason = z.infer<typeof ChatUnavailableReason>

/** `GET /api/chat/status`. */
export const ChatStatus = z.object({
  available: z.boolean(),
  reason: ChatUnavailableReason.nullable(),
  privacyNotice: z.string(),
})
export type ChatStatus = z.infer<typeof ChatStatus>

/** Body of `POST /api/chat/messages`. */
export const ChatMessageRequest = z.object({
  /** Missing, not found or silent over 24 h opens a new conversation. */
  conversationId: z.uuid().optional(),
  content: z
    .string({ error: 'Nhập câu hỏi' })
    .trim()
    .min(1, 'Nhập câu hỏi')
    .max(CHAT_MESSAGE_MAX_LENGTH, `Câu hỏi tối đa ${CHAT_MESSAGE_MAX_LENGTH} ký tự`),
  /** Slug of the product being viewed, so the chatbot understands "cái này" (ticket 03). */
  viewingProductSlug: z.string().max(200).optional(),
})
export type ChatMessageRequest = z.infer<typeof ChatMessageRequest>

export const ChatRole = z.enum(['customer', 'assistant'])
export type ChatRole = z.infer<typeof ChatRole>

/** Messages shown again when the chat opens. `failed`: a customer message with no answer. */
export const ChatMessageView = z.object({
  id: z.string(),
  role: ChatRole,
  content: z.string(),
  failed: z.boolean(),
  /**
   * Chatbot message: suggested products, enough to show links on reopen (price and image are on the cards at answer
   * time).
   */
  products: z.array(z.object({ slug: z.string(), name: z.string() })),
  createdAt: z.string(),
})
export type ChatMessageView = z.infer<typeof ChatMessageView>

/**
 * A turn's result: `answered` with the answer; `exhausted` or `failed` means the customer message was stored without
 * an answer; `disabled`, `unconfigured` means it was not stored.
 */
export const ChatTurnOutcome = z.enum(['answered', 'exhausted', 'failed', 'disabled', 'unconfigured'])
export type ChatTurnOutcome = z.infer<typeof ChatTurnOutcome>

/** Response of `POST /api/chat/messages`. */
export const ChatTurnResponse = z.object({
  /** The conversation in use; differs from the sent id when a new one was opened. `null` when nothing was stored. */
  conversationId: z.string().nullable(),
  outcome: ChatTurnOutcome,
  reply: ChatMessageView.nullable(),
  /** Cards of products the chatbot found this turn, built from the DB (price and status at answer time). */
  cards: z.array(ProductCard),
  /** The chatbot offers a handoff: the chat shows a confirm button (ticket 05). */
  handoffSuggested: z.boolean(),
})
export type ChatTurnResponse = z.infer<typeof ChatTurnResponse>

/** `GET /api/chat/conversations/:id`. `active`: still usable; otherwise the next message opens a new one. */
export const ChatConversationView = z.object({
  id: z.string(),
  active: z.boolean(),
  messages: z.array(ChatMessageView),
})
export type ChatConversationView = z.infer<typeof ChatConversationView>

/** Chatbot settings (`GET/PUT /api/admin/chatbot/settings`). */
export const ChatbotSettings = z.object({
  enabled: z.boolean(),
  responseTimeNote: z.string().trim().max(300, 'Tối đa 300 ký tự'),
})
export type ChatbotSettings = z.infer<typeof ChatbotSettings>

/**
 * Body of `POST /api/chat/handoff`: the customer confirms the handoff. Signed-in customers need no name or email;
 * guests must give both. Without a conversation (chatbot off) a message is required.
 */
export const ChatHandoffRequest = z.object({
  conversationId: z.uuid().optional(),
  name: z.string().trim().min(1, 'Nhập tên').max(100, 'Tên tối đa 100 ký tự').optional(),
  // Trim and lowercase before validating: the open request limit counts by email (ticket 05).
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Email không hợp lệ')).optional(),
  message: z.string().trim().max(2000, 'Lời nhắn tối đa 2.000 ký tự').default(''),
})
export type ChatHandoffRequest = z.input<typeof ChatHandoffRequest>

/** Returned once the request exists: its code and the owner's response-time sentence (empty if none). */
export const ChatHandoffResponse = z.object({
  requestCode: z.number(),
  responseTimeNote: z.string(),
  /** Path to the request for signed-in customers; guests open it via the emailed link. */
  link: z.string().nullable(),
})
export type ChatHandoffResponse = z.infer<typeof ChatHandoffResponse>

/** Query of `GET /api/admin/chatbot/conversations`: Vietnam-time days, filtered by the conversation's last message. */
export const AdminChatConversationQuery = PageQuery.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** `true`: only handed-off conversations; `false`: only those not handed off. */
  handedOff: z.stringbool().optional(),
  /** `true`: only conversations with an unanswered turn (error or out of quota). */
  failed: z.stringbool().optional(),
})
export type AdminChatConversationQuery = z.input<typeof AdminChatConversationQuery>

/** A row in the owner's conversation list. No IP. */
export const AdminChatConversationSummary = z.object({
  id: z.string(),
  createdAt: z.string(),
  lastMessageAt: z.string(),
  customerMessageCount: z.number(),
  /** The customer's first question, truncated. */
  firstQuestion: z.string(),
  failedTurns: z.number(),
  /** Support request code once handed off. */
  supportRequestCode: z.number().nullable(),
})
export type AdminChatConversationSummary = z.infer<typeof AdminChatConversationSummary>

export const AdminChatConversationPage = pageOf(AdminChatConversationSummary)
export type AdminChatConversationPage = z.infer<typeof AdminChatConversationPage>

/** One conversation for the owner: each message with the answering model, prompt version and turn error. */
export const AdminChatConversation = z.object({
  id: z.string(),
  createdAt: z.string(),
  lastMessageAt: z.string(),
  supportRequestCode: z.number().nullable(),
  messages: z.array(
    ChatMessageView.extend({
      model: z.string().nullable(),
      promptVersion: z.number().nullable(),
      error: z.string().nullable(),
      handoffSummary: z.string().nullable(),
    }),
  ),
})
export type AdminChatConversation = z.infer<typeof AdminChatConversation>

/** `GET /api/admin/chatbot/status`: the chain's models (ADR 0017) and when each exhausted mark expires. */
export const ChatbotModelStatus = z.object({
  /** `false`: the server has no model key, so the chatbot cannot answer even when on. */
  configured: z.boolean(),
  models: z.array(z.object({ model: z.string(), exhaustedUntil: z.string().nullable() })),
})
export type ChatbotModelStatus = z.infer<typeof ChatbotModelStatus>
