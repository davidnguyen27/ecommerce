import type { VoucherConflict } from '@ecommerce/shared'

/**
 * Mã giảm giá khách đang áp ở trang đặt mua và đặt trước. Trang gửi `voucherCode` kèm mọi lần báo giá; `voucherConflict`
 * là 409 về mã lúc đặt (khách chọn đặt tiếp không mã hay quay lại).
 *
 * Lượt mỗi khách chỉ kiểm được khi có email hoặc số điện thoại, nên khi đang áp mã mà khách sửa hai ô đó thì báo giá lại
 * (chờ khách gõ xong), để thấy "bạn đã dùng mã này" trước khi bấm đặt thay vì nhận 409.
 */
export function useVoucherCode(refreshQuote: () => Promise<void>, contact: () => readonly [string, string]) {
  const voucherCode = ref<string | null>(null)
  const voucherConflict = ref<VoucherConflict | null>(null)

  function applyVoucher(code: string) {
    voucherCode.value = code
    voucherConflict.value = null
    return refreshQuote()
  }

  function removeVoucher() {
    voucherCode.value = null
    voucherConflict.value = null
    return refreshQuote()
  }

  // Mỗi lần báo giá kèm mã tính vào giới hạn chống dò mã (10 lần mỗi phút), nên chờ khách ngừng gõ.
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(contact, () => {
    clearTimeout(timer)
    if (voucherCode.value) timer = setTimeout(() => void refreshQuote(), 1_000)
  })
  onScopeDispose(() => clearTimeout(timer))

  return { voucherCode, voucherConflict, applyVoucher, removeVoucher }
}
