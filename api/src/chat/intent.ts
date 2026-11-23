/**
 * Khách nhắc tới nhân viên hay người thật (có dấu, không dấu, tiếng Anh). Model không gọi `handoff` đều đặn khi khách
 * đòi gặp người (chatbot-check 2026-11-21: 1/3 lần khi đang xem sản phẩm), nên API tự đề nghị chuyển theo câu của khách.
 * Bắt nhầm (ví dụ hỏi về nhân viên giao hàng) chỉ làm nút "Gặp nhân viên" nổi bật, không tạo gì.
 */
const ASKS_FOR_STAFF =
  /nh[aâ]n\s*vi[eê]n|ng[uư][oờ]i\s*th[aậ]t|t[uư]\s*v[aấ]n\s*vi[eê]n|\bhuman\b|real\s+person|\bstaff\b|\bagent\b/i

export function asksForStaff(text: string): boolean {
  return ASKS_FOR_STAFF.test(text)
}

/** Chữ cái chỉ tiếng Việt mới có (kể cả dấu thanh): có một chữ là tin tiếng Việt. */
const VIETNAMESE_LETTER = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i
const ENGLISH_WORD =
  /\b(the|a|an|do|does|you|your|have|has|is|are|what|which|how|can|i|my|me|for|under|with|any|price|size|ship|order|bag|shoes?|sneakers?|watch|black|white)\b/gi

/**
 * Tin của khách là tiếng Anh: không có chữ cái riêng của tiếng Việt và có từ hai từ tiếng Anh thông dụng trở lên. Khách
 * Việt gõ không dấu ("co tui den khong") không có từ tiếng Anh nào nên không bị nhầm. Lời nhắc chung trong prompt không
 * đủ: qwen vẫn trả lời tiếng Việt cho tin tiếng Anh khi danh mục và chính sách đều tiếng Việt (chatbot-check 2026-11-21).
 */
export function looksEnglish(text: string): boolean {
  if (VIETNAMESE_LETTER.test(text)) return false
  return (text.match(ENGLISH_WORD)?.length ?? 0) >= 2
}

/** Nói về size: "size", "cỡ", hệ size EU, US, UK. "cỡ" không kèm `\b`: regex coi "ỡ" không phải chữ cái. */
const SIZE_WORD = /\b(?:size|eu|us|uk)\b|(?<![a-zà-ỹ])cỡ(?![a-zà-ỹ])/i
/**
 * Một con số có dạng size giày, quần áo (30–49, hay 5–13 kiểu US), kể cả "38,5". Số không cần đứng sát chữ size:
 * model hay viết "size EU thường tương ứng là 41" (chatbot-check 2026-11-22).
 */
const SIZE_NUMBER = /(?<![\d.,])(?:[34]\d|[5-9]|1[0-3])(?:,5)?(?![\d.,]?\d)(?!\s*(?:cm|mm|triệu|nghìn|k\b|%))/i
/** Cụm từ gợi ý một size hợp với khách. */
const RECOMMENDS =
  /phù hợp|gợi ý|khuyên|tương ứng|nên (?:chọn|đi|mặc|lấy|mang)|vừa với|thường|\bfits?\b|recommend|suggest|should|would suit|corresponds?|usually|typically/i

/**
 * Câu trả lời có gợi ý size: một câu nói về size, có một con số dạng size, và có cụm gợi ý. "Size 41 còn hàng" không
 * tính. Bắt nhầm chỉ tốn thêm một lần gọi model để viết lại (`runTurn`).
 */
export function suggestsSize(text: string): boolean {
  return text
    .split(/[!?\n]+|\.(?!\d)/)
    .some((sentence) => SIZE_WORD.test(sentence) && SIZE_NUMBER.test(sentence) && RECOMMENDS.test(sentence))
}

/** URL đầy đủ tới trang sản phẩm hay chính sách, kể cả dạng `<…>`; nhóm 1 là đường dẫn của shop. */
const ABSOLUTE_SHOP_LINK = /<?https?:\/\/[^\s/()<>[\]]+(\/(?:san-pham|trang)\/[a-z0-9-]+)>?/gi

/**
 * Đổi link sản phẩm, chính sách mà model tự gắn tên miền ("https://www.example.com/san-pham/…", đi luồng demo
 * 2026-11-23: 3/6 lần) thành đường dẫn của shop, để link mở đúng trang. Prompt chỉ đưa đường dẫn, model tự bịa tên miền.
 */
export function relativeShopLinks(text: string): string {
  return htmlLinksToMarkdown(text).replace(ABSOLUTE_SHOP_LINK, '$1')
}

/** Thẻ `<a href="…">chữ</a>`; nhóm 1 là href, nhóm 2 là chữ (bỏ thẻ con). */
const HTML_LINK = /<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

/**
 * Model đôi khi viết link bằng HTML (`<a href="/san-pham/…">Xem chi tiết</a>`, demo 2026-11-23: 3/5 lần sau khi gpt-oss
 * chuyển sang `reasoning_effort: 'medium'`). Khung chat render markdown với `html: false` nên khách thấy nguyên chuỗi
 * thẻ; đổi thành link markdown, markdown-it vẫn chặn link nguy hiểm như `javascript:`.
 */
function htmlLinksToMarkdown(text: string): string {
  return text.replace(HTML_LINK, (_tag, href: string, inner: string) => {
    const label = inner.replace(/<[^>]*>/g, '').trim() || href
    return `[${label}](${href})`
  })
}

/** Nhãn công cụ đầu dòng: "Tool: handoff - ", "[Tool call: get_product(...)]", "Function: search_products:". */
const TOOL_LABEL =
  /^[ \t]*\[?(?:tool|function)(?:[ \t]+call)?[ \t]*:[ \t]*[a-z_]+(?:\([^)\n]*\))?\]?[ \t]*(?:[-–—:][ \t]*)?/gim

/**
 * Bỏ nhãn công cụ model viết lẫn vào câu trả lời: qwen từng trả lời "Tool: handoff - Tôi sẽ chuyển bạn…" (2026-11-22).
 * Giữ phần chữ sau nhãn; dòng chỉ có nhãn thì bỏ cả dòng. Không có nhãn thì trả nguyên văn.
 */
export function stripToolLabels(text: string): string {
  const stripped = text.replace(TOOL_LABEL, '')
  if (stripped === text) return text
  return stripped
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*\n/, '')
    .trim()
}

/** Một câu, kèm dấu câu và khoảng trắng sau nó; dấu chấm trong số ("25.5") không cắt câu. */
const SENTENCE = /(?:[^.!?\n]|\.(?=\d))+(?:[.!?]+|$)[ \t]*/gm
/**
 * Chatbot nói chính nó đã làm ("mình đã gửi", "I've forwarded"), hay yêu cầu của khách đã được gửi. Câu chính sách kiểu
 * "sau khi yêu cầu đã được gửi, nhân viên sẽ phản hồi" không tính.
 */
const VERB_VI = '(?:gửi|chuyển|kết nối|báo|thông báo|liên hệ)'
const VERB_EN = '(?:sent|forwarded|transferred|passed|escalated|connected|notified)'
const SENT = new RegExp(
  `(?:mình|tôi|em|chúng tôi)\\s+(?:đã|vừa)\\s+${VERB_VI}|của (?:bạn|anh|chị)\\s+(?:đã|vừa)\\s+được\\s+${VERB_VI}` +
    `|\\b(?:I|we)(?:'ve|\\s+have)?\\s+(?:just\\s+|already\\s+)?${VERB_EN}\\b` +
    `|\\byour\\s+(?:request|question|message|conversation)\\s+(?:has|have)\\s+(?:just\\s+|already\\s+)?been\\s+${VERB_EN}\\b`,
  'i',
)
/** Câu đó nói về nhân viên hay yêu cầu hỗ trợ, không phải ví dụ "hàng đã gửi đi". */
const TO_STAFF =
  /nhân viên|yêu cầu|bộ phận|tư vấn viên|người hỗ trợ|\bstaff\b|\bteam\b|\bagents?\b|\brequest\b|\bhuman\b|\bsupport\b/i
/** Câu trả lời còn lại đã mời khách bấm nút thì không thêm lời mời. */
const INVITES = /bấm|nhấn|\bpress\b|\bclick\b|\btap\b/i
const INVITE_VI = 'Bạn bấm nút "Gặp nhân viên" bên dưới để gửi câu hỏi cho nhân viên nhé.'
const INVITE_EN = 'Press the "Gặp nhân viên" button below to send your question to our staff.'

/**
 * Bỏ các câu nói đã gửi, đã chuyển cho nhân viên: chưa có gì được gửi tới khi khách bấm xác nhận. Prompt đã cấm, nhưng
 * qwen vẫn viết "Mình đã gửi yêu cầu chuyển cho nhân viên" (chatbot-check 2026-11-21). Bỏ câu thay vì gọi model viết
 * lại: không tốn thêm lượt; còn câu nào mời bấm nút thì giữ, không còn thì thêm lời mời. Không có câu như vậy thì trả
 * nguyên văn.
 */
export function dropSentClaims(text: string, english: boolean): string {
  let dropped = false
  const kept = text
    .replace(SENTENCE, (sentence) => {
      if (!SENT.test(sentence) || !TO_STAFF.test(sentence)) return sentence
      dropped = true
      return ''
    })
    .trim()
  if (!dropped) return text
  if (INVITES.test(kept)) return kept
  const invite = english ? INVITE_EN : INVITE_VI
  return kept ? `${kept}\n\n${invite}` : invite
}
