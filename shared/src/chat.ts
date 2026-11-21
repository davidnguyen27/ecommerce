import { z } from 'zod'
import { PageQuery, pageOf } from './pagination.ts'
import { ProductCard } from './products.ts'

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
  /** Tin của chatbot: sản phẩm đã gợi ý, đủ để hiện link khi mở lại khung chat (giá, ảnh xem ở thẻ lúc trả lời). */
  products: z.array(z.object({ slug: z.string(), name: z.string() })),
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
  /** Thẻ của các sản phẩm chatbot đã tìm trong lượt này, dựng từ DB (giá, tình trạng đúng lúc trả lời). */
  cards: z.array(ProductCard),
  /** Chatbot đề nghị chuyển nhân viên: khung chat hiện nút xác nhận (ticket 05). */
  handoffSuggested: z.boolean(),
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

/**
 * Body của `POST /api/chat/handoff`: khách xác nhận chuyển nhân viên. Khách đã đăng nhập không cần tên, email; khách
 * vãng lai thì bắt buộc. Không có cuộc trò chuyện (chatbot đang tắt) thì phải có lời nhắn.
 */
export const ChatHandoffRequest = z.object({
  conversationId: z.uuid().optional(),
  name: z.string().trim().min(1, 'Nhập tên').max(100, 'Tên tối đa 100 ký tự').optional(),
  // Cắt khoảng trắng và đổi chữ thường trước khi kiểm: giới hạn yêu cầu mở tính theo email (ticket 05).
  email: z.string().trim().toLowerCase().max(254).pipe(z.email('Email không hợp lệ')).optional(),
  message: z.string().trim().max(2000, 'Lời nhắn tối đa 2.000 ký tự').default(''),
})
export type ChatHandoffRequest = z.input<typeof ChatHandoffRequest>

/** Trả về khi đã tạo yêu cầu: mã yêu cầu và câu thời gian phản hồi owner soạn (rỗng là không có). */
export const ChatHandoffResponse = z.object({
  requestCode: z.number(),
  responseTimeNote: z.string(),
  /** Đường dẫn xem yêu cầu khi khách đã đăng nhập; khách vãng lai mở bằng link trong email. */
  link: z.string().nullable(),
})
export type ChatHandoffResponse = z.infer<typeof ChatHandoffResponse>

/** Query của `GET /api/admin/chatbot/conversations`: ngày theo giờ Việt Nam, lọc theo tin cuối của cuộc. */
export const AdminChatConversationQuery = PageQuery.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** `true`: chỉ cuộc đã chuyển nhân viên; `false`: chỉ cuộc chưa chuyển. */
  handedOff: z.stringbool().optional(),
  /** `true`: chỉ cuộc có lượt không trả lời được (lỗi hay hết lượt). */
  failed: z.stringbool().optional(),
})
export type AdminChatConversationQuery = z.input<typeof AdminChatConversationQuery>

/** Một dòng trong danh sách cuộc trò chuyện của owner. Không có IP. */
export const AdminChatConversationSummary = z.object({
  id: z.string(),
  createdAt: z.string(),
  lastMessageAt: z.string(),
  customerMessageCount: z.number(),
  /** Câu hỏi đầu của khách, cắt ngắn. */
  firstQuestion: z.string(),
  failedTurns: z.number(),
  /** Mã yêu cầu hỗ trợ khi đã chuyển nhân viên. */
  supportRequestCode: z.number().nullable(),
})
export type AdminChatConversationSummary = z.infer<typeof AdminChatConversationSummary>

export const AdminChatConversationPage = pageOf(AdminChatConversationSummary)
export type AdminChatConversationPage = z.infer<typeof AdminChatConversationPage>

/** Chi tiết một cuộc cho owner: mỗi tin kèm model đã trả lời, phiên bản prompt và lỗi của lượt. */
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

/** `GET /api/admin/chatbot/status`: các model của chuỗi (ADR 0017) và lúc hết bị đánh dấu đang hết lượt. */
export const ChatbotModelStatus = z.object({
  /** `false`: máy chủ chưa đặt khóa model nào, chatbot không trả lời được dù bật. */
  configured: z.boolean(),
  models: z.array(z.object({ model: z.string(), exhaustedUntil: z.string().nullable() })),
})
export type ChatbotModelStatus = z.infer<typeof ChatbotModelStatus>
