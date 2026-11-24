import type { ChatMessageView, ChatTurnOutcome, ChatUnavailableReason, ProductCard } from '@ecommerce/shared'

/** localStorage key holding the conversation id, so it survives navigation and reloads (spec M8). */
export const CHAT_STORAGE_KEY = 'chat-conversation'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The saved conversation id; odd values count as none. */
export function readConversationId(raw: string | null): string | null {
  return raw && UUID.test(raw) ? raw : null
}

/** Checkout, pre-order and payment pages have no chat widget (spec M8), so it never covers the order button. */
const HIDDEN_PATHS = [/^\/dat-mua\/?$/, /^\/dat-truoc\//, /^\/thanh-toan-gia-lap\/?$/, /^\/admin(\/|$)/]

export function chatHiddenOn(path: string): boolean {
  return HIDDEN_PATHS.some((pattern) => pattern.test(path))
}

/** The product slug when on a product page, so the chatbot understands "cái này". */
export function viewingProductSlug(path: string): string | undefined {
  const match = /^\/san-pham\/([^/?#]+)\/?$/.exec(path)
  return match ? decodeURIComponent(match[1]!) : undefined
}

/** Why the chatbot does not answer, as customers read it. */
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

/** A chat message. Full product cards exist only for the latest answer; on reopen only name links remain. */
export type ChatEntry = ChatMessageView & { cards: ProductCard[] }

export function toEntries(messages: readonly ChatMessageView[]): ChatEntry[] {
  return messages.map((message) => ({ ...message, cards: [] }))
}

/**
 * The customer's message shows as soon as it is sent, before the answer; the temporary id is replaced by the real
 * message if needed. The question is trimmed as the API stores it.
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

/**
 * Turns bare product and policy paths the chatbot writes ("/san-pham/air-max-90") into markdown links, since
 * markdown-it does not autolink relative paths. Paths already inside a markdown link stay as they are.
 */
export function linkifyShopPaths(text: string): string {
  return text.replace(/(?<![([/\w])\/(?:san-pham|trang)\/[a-z0-9-]+(?![\w\]])/g, (path) => `[${path}](${path})`)
}
