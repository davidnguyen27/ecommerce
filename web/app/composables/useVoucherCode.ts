import type { VoucherConflict } from '@ecommerce/shared'

/**
 * The voucher applied on the checkout and pre-order pages. The page sends `voucherCode` with every quote;
 * `voucherConflict` is the voucher 409 at order time (the customer continues without it or goes back).
 * Per-customer uses can only be checked with an email or phone, so editing those fields while a voucher is applied
 * re-quotes (after typing stops), showing "bạn đã dùng mã này" before ordering instead of a 409.
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

  // Every voucher quote counts toward the code-guessing limit (10 per minute), so wait until typing stops.
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(contact, () => {
    clearTimeout(timer)
    if (voucherCode.value) timer = setTimeout(() => void refreshQuote(), 1_000)
  })
  onScopeDispose(() => clearTimeout(timer))

  return { voucherCode, voucherConflict, applyVoucher, removeVoucher }
}
