/**
 * The customer mentions staff or a human (with or without diacritics, or English). The model does not call `handoff`
 * reliably when asked for a person (chatbot-check 2026-11-21: 1/3 while viewing a product), so the API offers handoff
 * from the message itself. False hits (e.g. asking about delivery staff) only highlight the "Gặp nhân viên" button.
 */
const ASKS_FOR_STAFF =
  /nh[aâ]n\s*vi[eê]n|ng[uư][oờ]i\s*th[aậ]t|t[uư]\s*v[aấ]n\s*vi[eê]n|\bhuman\b|real\s+person|\bstaff\b|\bagent\b/i

export function asksForStaff(text: string): boolean {
  return ASKS_FOR_STAFF.test(text)
}

/** Letters only Vietnamese has (tone marks included): one is enough to call the message Vietnamese. */
const VIETNAMESE_LETTER = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i
const ENGLISH_WORD =
  /\b(the|a|an|do|does|you|your|have|has|is|are|what|which|how|can|i|my|me|for|under|with|any|price|size|ship|order|bag|shoes?|sneakers?|watch|black|white)\b/gi

/**
 * The message is English: no Vietnamese-only letters and at least two common English words. Vietnamese typed without
 * diacritics ("co tui den khong") has no English words, so it is not misread. A general prompt hint was not enough:
 * qwen still answered English messages in Vietnamese when catalog and policies were Vietnamese (chatbot-check
 * 2026-11-21).
 */
export function looksEnglish(text: string): boolean {
  if (VIETNAMESE_LETTER.test(text)) return false
  return (text.match(ENGLISH_WORD)?.length ?? 0) >= 2
}

/** Talks about size: "size", "cỡ", EU/US/UK sizes. "cỡ" has no `\b`: regex does not treat "ỡ" as a letter. */
const SIZE_WORD = /\b(?:size|eu|us|uk)\b|(?<![a-zà-ỹ])cỡ(?![a-zà-ỹ])/i
/**
 * A number shaped like a shoe or clothing size (30–49, or US 5–13), "38,5" included. It need not sit next to the size
 * word: the model often writes "size EU thường tương ứng là 41" (chatbot-check 2026-11-22).
 */
const SIZE_NUMBER = /(?<![\d.,])(?:[34]\d|[5-9]|1[0-3])(?:,5)?(?![\d.,]?\d)(?!\s*(?:cm|mm|triệu|nghìn|k\b|%))/i
/** Phrases suggesting a size fits the customer. */
const RECOMMENDS =
  /phù hợp|gợi ý|khuyên|tương ứng|nên (?:chọn|đi|mặc|lấy|mang)|vừa với|thường|\bfits?\b|recommend|suggest|should|would suit|corresponds?|usually|typically/i

/**
 * The answer suggests a size: a sentence about size, a size-shaped number and a suggesting phrase. "Size 41 còn hàng"
 * does not count. A false hit only costs one rewrite call (`runTurn`).
 */
export function suggestsSize(text: string): boolean {
  return text
    .split(/[!?\n]+|\.(?!\d)/)
    .some((sentence) => SIZE_WORD.test(sentence) && SIZE_NUMBER.test(sentence) && RECOMMENDS.test(sentence))
}

/** Full URL to a product or policy page, `<…>` form included; group 1 is the shop path. */
const ABSOLUTE_SHOP_LINK = /<?https?:\/\/[^\s/()<>[\]]+(\/(?:san-pham|trang)\/[a-z0-9-]+)>?/gi

/**
 * Turns product and policy links where the model invented a domain ("https://www.example.com/san-pham/…", demo
 * walkthrough 2026-11-23: 3/6) into shop paths, so links open the right page. The prompt only gives paths.
 */
export function relativeShopLinks(text: string): string {
  return htmlLinksToMarkdown(text).replace(ABSOLUTE_SHOP_LINK, '$1')
}

/** An `<a href="…">text</a>` tag; group 1 is the href, group 2 the text (child tags dropped). */
const HTML_LINK = /<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

/**
 * The model sometimes writes HTML links (`<a href="/san-pham/…">Xem chi tiết</a>`, demo 2026-11-23: 3/5 after gpt-oss
 * moved to `reasoning_effort: 'medium'`). The chat renders markdown with `html: false`, so customers saw raw tags;
 * convert to markdown links, where markdown-it still blocks dangerous ones like `javascript:`.
 */
function htmlLinksToMarkdown(text: string): string {
  return text.replace(HTML_LINK, (_tag, href: string, inner: string) => {
    const label = inner.replace(/<[^>]*>/g, '').trim() || href
    return `[${label}](${href})`
  })
}

/** Leading tool labels: "Tool: handoff - ", "[Tool call: get_product(...)]", "Function: search_products:". */
const TOOL_LABEL =
  /^[ \t]*\[?(?:tool|function)(?:[ \t]+call)?[ \t]*:[ \t]*[a-z_]+(?:\([^)\n]*\))?\]?[ \t]*(?:[-–—:][ \t]*)?/gim

/**
 * Strips tool labels the model mixes into answers: qwen once replied "Tool: handoff - Tôi sẽ chuyển bạn…" (2026-11-22).
 * Keeps the text after the label; label-only lines are dropped. Without labels the text is returned as is.
 */
export function stripToolLabels(text: string): string {
  const stripped = text.replace(TOOL_LABEL, '')
  if (stripped === text) return text
  return stripped
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s*\n/, '')
    .trim()
}

/** One sentence with its punctuation and trailing space; dots inside numbers ("25.5") do not split. */
const SENTENCE = /(?:[^.!?\n]|\.(?=\d))+(?:[.!?]+|$)[ \t]*/gm
/**
 * The chatbot claims it acted ("mình đã gửi", "I've forwarded"), or that the request was sent. Policy sentences like
 * "sau khi yêu cầu đã được gửi, nhân viên sẽ phản hồi" do not count.
 */
const VERB_VI = '(?:gửi|chuyển|kết nối|báo|thông báo|liên hệ)'
const VERB_EN = '(?:sent|forwarded|transferred|passed|escalated|connected|notified)'
const SENT = new RegExp(
  `(?:mình|tôi|em|chúng tôi)\\s+(?:đã|vừa)\\s+${VERB_VI}|của (?:bạn|anh|chị)\\s+(?:đã|vừa)\\s+được\\s+${VERB_VI}` +
    `|\\b(?:I|we)(?:'ve|\\s+have)?\\s+(?:just\\s+|already\\s+)?${VERB_EN}\\b` +
    `|\\byour\\s+(?:request|question|message|conversation)\\s+(?:has|have)\\s+(?:just\\s+|already\\s+)?been\\s+${VERB_EN}\\b`,
  'i',
)
/** The sentence is about staff or a support request, not e.g. "hàng đã gửi đi". */
const TO_STAFF =
  /nhân viên|yêu cầu|bộ phận|tư vấn viên|người hỗ trợ|\bstaff\b|\bteam\b|\bagents?\b|\brequest\b|\bhuman\b|\bsupport\b/i
/** The remaining answer already invites the customer to press the button, so no invitation is added. */
const INVITES = /bấm|nhấn|\bpress\b|\bclick\b|\btap\b/i
const INVITE_VI = 'Bạn bấm nút "Gặp nhân viên" bên dưới để gửi câu hỏi cho nhân viên nhé.'
const INVITE_EN = 'Press the "Gặp nhân viên" button below to send your question to our staff.'

/**
 * Drops sentences claiming a handoff was sent: nothing is sent until the customer confirms. The prompt forbids it, but
 * qwen still wrote "Mình đã gửi yêu cầu chuyển cho nhân viên" (chatbot-check 2026-11-21). Dropping avoids a rewrite
 * call; a sentence inviting the button is kept, else an invitation is added. Otherwise the text is returned as is.
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
