import { z } from 'zod'

/** Tin của khách dài tối đa (spec M8, số tạm). */
export const CHAT_MESSAGE_MAX_LENGTH = 500
/** Số tin của khách tối đa trong một cuộc trò chuyện (spec M8, số tạm). */
export const CHAT_MESSAGES_PER_CONVERSATION = 30

/** Dòng hiện ở đầu khung chat (spec M8 "Web"); chính sách bảo mật có đoạn giải thích chi tiết. */
export const CHAT_PRIVACY_NOTICE =
  'Cuộc trò chuyện được lưu 90 ngày và xử lý bởi nhà cung cấp AI bên ngoài; đừng nhập thông tin nhạy cảm.'

/**
 * Vì sao chatbot không trả lời được: owner tắt, máy chủ chưa có khóa model nào, hay mọi model đang hết lượt (ADR 0017).
 * `null` là đang trả lời được.
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

/** Body của `POST /api/chat/messages`. */
export const ChatMessageRequest = z.object({
  /** Không có, không thấy hay đã im quá 24 giờ thì mở cuộc mới. */
  conversationId: z.uuid().optional(),
  content: z
    .string({ error: 'Nhập câu hỏi' })
    .trim()
    .min(1, 'Nhập câu hỏi')
    .max(CHAT_MESSAGE_MAX_LENGTH, `Câu hỏi tối đa ${CHAT_MESSAGE_MAX_LENGTH} ký tự`),
  /** Slug sản phẩm khách đang xem, để chatbot hiểu "cái này" (ticket 03). */
  viewingProductSlug: z.string().max(200).optional(),
})
export type ChatMessageRequest = z.infer<typeof ChatMessageRequest>

export const ChatRole = z.enum(['customer', 'assistant'])
export type ChatRole = z.infer<typeof ChatRole>

/** Tin khách thấy lại khi mở khung chat. `failed`: tin của khách không có trả lời. */
export const ChatMessageView = z.object({
  id: z.string(),
  role: ChatRole,
  content: z.string(),
  failed: z.boolean(),
  createdAt: z.string(),
})
export type ChatMessageView = z.infer<typeof ChatMessageView>

/**
 * Kết quả một lượt: `answered` kèm câu trả lời; `exhausted` hay `failed` thì tin của khách đã lưu nhưng không có trả
 * lời; `disabled`, `unconfigured` thì tin không được lưu.
 */
export const ChatTurnOutcome = z.enum(['answered', 'exhausted', 'failed', 'disabled', 'unconfigured'])
export type ChatTurnOutcome = z.infer<typeof ChatTurnOutcome>

/** Trả về của `POST /api/chat/messages`. */
export const ChatTurnResponse = z.object({
  /** Cuộc đang dùng; khác mã gửi lên khi vừa mở cuộc mới. `null` khi tin không được lưu. */
  conversationId: z.string().nullable(),
  outcome: ChatTurnOutcome,
  reply: ChatMessageView.nullable(),
})
export type ChatTurnResponse = z.infer<typeof ChatTurnResponse>

/** `GET /api/chat/conversations/:id`. `active`: còn dùng tiếp được; hết thì tin tiếp theo mở cuộc mới. */
export const ChatConversationView = z.object({
  id: z.string(),
  active: z.boolean(),
  messages: z.array(ChatMessageView),
})
export type ChatConversationView = z.infer<typeof ChatConversationView>

/** Cài đặt chatbot (`GET/PUT /api/admin/chatbot/settings`). */
export const ChatbotSettings = z.object({
  enabled: z.boolean(),
  responseTimeNote: z.string().trim().max(300, 'Tối đa 300 ký tự'),
})
export type ChatbotSettings = z.infer<typeof ChatbotSettings>
