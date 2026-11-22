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
