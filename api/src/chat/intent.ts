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
