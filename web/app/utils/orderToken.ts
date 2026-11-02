// Token tra cứu đơn giữ ở sessionStorage của tab đặt mua, để khi cổng thanh toán đưa khách quay về trang kết quả
// (URL chỉ có mã đơn) trang vẫn mở được đơn. Cổng không bao giờ thấy token. Trình duyệt chặn storage thì bỏ qua.
const key = (code: number | string) => `order-token:${code}`

export function rememberOrderToken(code: number, token: string) {
  try {
    sessionStorage.setItem(key(code), token)
  } catch {
    // Không lưu được thì khách mở đơn bằng link trong email.
  }
}

export function recallOrderToken(code: string): string | null {
  try {
    return sessionStorage.getItem(key(code))
  } catch {
    return null
  }
}
