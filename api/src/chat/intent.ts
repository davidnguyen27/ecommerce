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
