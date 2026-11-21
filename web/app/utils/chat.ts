import type { ChatMessageView, ChatTurnOutcome, ChatUnavailableReason, ProductCard } from '@ecommerce/shared'

/** Khóa localStorage giữ mã cuộc trò chuyện, để cuộc còn khi chuyển trang hay tải lại (spec M8). */
export const CHAT_STORAGE_KEY = 'chat-conversation'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Mã cuộc trò chuyện đã lưu; giá trị lạ coi như chưa có. */
export function readConversationId(raw: string | null): string | null {
  return raw && UUID.test(raw) ? raw : null
}

/** Trang đặt mua, đặt trước và thanh toán không có khung chat (spec M8), để không che nút đặt mua. */
const HIDDEN_PATHS = [/^\/dat-mua\/?$/, /^\/dat-truoc\//, /^\/thanh-toan-gia-lap\/?$/, /^\/admin(\/|$)/]

export function chatHiddenOn(path: string): boolean {
  return HIDDEN_PATHS.some((pattern) => pattern.test(path))
}

/** Slug sản phẩm khi khách đang ở trang sản phẩm, để chatbot hiểu "cái này". */
export function viewingProductSlug(path: string): string | undefined {
  const match = /^\/san-pham\/([^/?#]+)\/?$/.exec(path)
  return match ? decodeURIComponent(match[1]!) : undefined
}

/** Lý do chatbot không trả lời, như khách đọc. */
export function unavailableText(reason: ChatUnavailableReason | Exclude<ChatTurnOutcome, 'answered'>): string {
  switch (reason) {
    case 'exhausted':
      return 'Trợ lý đã hết lượt trả lời hôm nay. Bạn thử lại sau, hoặc gửi câu hỏi cho nhân viên.'
    case 'failed':
      return 'Trợ lý tạm không trả lời được. Bạn thử lại sau ít phút, hoặc gửi câu hỏi cho nhân viên.'
    default:
      return 'Trợ lý đang tạm nghỉ. Bạn có thể gửi câu hỏi cho nhân viên.'
  }
}

/** Một tin trong khung chat. Thẻ sản phẩm đầy đủ chỉ có ở lượt vừa trả lời; mở lại thì chỉ còn link theo tên. */
export type ChatEntry = ChatMessageView & { cards: ProductCard[] }

export function toEntries(messages: readonly ChatMessageView[]): ChatEntry[] {
  return messages.map((message) => ({ ...message, cards: [] }))
}

/**
 * Tin của khách hiện ngay khi gửi, trước khi có trả lời; mã tạm được thay bằng tin thật nếu cần. Câu hỏi đã cắt
 * khoảng trắng như API lưu.
 */
export function pendingCustomerEntry(content: string, now = new Date()): ChatEntry {
  return {
    id: `pending-${now.getTime()}`,
    role: 'customer',
    content: content.trim(),
    failed: false,
    products: [],
    createdAt: now.toISOString(),
    cards: [],
  }
}
