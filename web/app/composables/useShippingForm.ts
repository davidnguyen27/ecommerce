import { LastShippingAddress, type InvoiceInfo, type ShippingAddress } from '@ecommerce/shared'
import type { Ward } from '@ecommerce/shared/wards'

export type ShippingFormFields = Required<{ [K in keyof ShippingAddress]: string }> & { note: string }
export type InvoiceFields = { [K in keyof InvoiceInfo]: string }

/**
 * Thông tin nhận hàng dùng chung cho đặt mua và đặt trước: địa chỉ, ghi chú, hóa đơn công ty, ô đồng ý chính sách bảo
 * mật (chỉ khách vãng lai). Khách đã đăng nhập được điền sẵn địa chỉ lần đặt trước. Danh mục phường/xã nặng nên chỉ nạp
 * ở trình duyệt. Mọi thứ chỉ chạy sau khi mount: đây là dữ liệu cá nhân, trang chỉ có khung khi SSR.
 */
export function useShippingForm() {
  const form = ref<ShippingFormFields>({
    recipientName: '',
    phone: '',
    email: '',
    provinceCode: '',
    wardCode: '',
    streetAddress: '',
    note: '',
  })
  const invoice = ref<InvoiceFields>({ companyName: '', taxCode: '', address: '' })
  // Phần hóa đơn thu gọn mặc định; mở ra khi server báo lỗi ở trường của nó.
  const invoiceOpen = ref(false)
  const acceptPrivacyPolicy = ref(false)

  // Khách đã đăng nhập đồng ý chính sách bảo mật lúc đăng ký, nên ô đồng ý chỉ hiện cho khách vãng lai.
  const session = useCustomerSession()
  const signedIn = ref<boolean | null>(null)
  onMounted(async () => {
    signedIn.value = await session.signedIn()
    if (signedIn.value) await fillLastAddress()
  })

  /** Khách đã đăng nhập: điền sẵn địa chỉ lần đặt trước, chỉ khi khách chưa gõ gì vào form. */
  async function fillLastAddress() {
    try {
      const { address } = LastShippingAddress.parse(await session.accountFetch('/api/account/shipping-address'))
      const f = form.value
      const untouched = [f.recipientName, f.phone, f.email, f.provinceCode, f.streetAddress].every((v) => v === '')
      if (!address || !untouched) return
      const { wardCode, ...rest } = address
      Object.assign(form.value, rest)
      // Đổi tỉnh/thành thì watcher xóa phường/xã; đợi watcher chạy xong rồi mới điền.
      await nextTick()
      form.value.wardCode = wardCode
    } catch {
      // Không điền được thì khách tự nhập như bình thường.
    }
  }

  const wardsOf = shallowRef<((provinceCode: string) => Ward[]) | null>(null)
  onMounted(async () => {
    wardsOf.value = (await import('@ecommerce/shared/wards')).wardsOf
  })
  const wards = computed(() => (wardsOf.value && form.value.provinceCode ? wardsOf.value(form.value.provinceCode) : []))
  watch(
    () => form.value.provinceCode,
    () => (form.value.wardCode = ''),
  )

  /** Địa chỉ, ghi chú và hóa đơn gửi API. Hóa đơn bỏ trống thì không gửi; điền dở thì gửi để server báo trường thiếu. */
  function contactPayload() {
    const { note, ...address } = form.value
    const wantsInvoice = Object.values(invoice.value).some((value) => value.trim() !== '')
    return { address, note, ...(wantsInvoice && { invoice: { ...invoice.value } }) }
  }

  /** Server báo lỗi ở trường hóa đơn thì mở phần hóa đơn để khách thấy. */
  function revealErrors(fieldErrors: Map<string, string>) {
    if ([...fieldErrors.keys()].some((path) => path.startsWith('invoice.'))) invoiceOpen.value = true
  }

  return { form, invoice, invoiceOpen, acceptPrivacyPolicy, session, signedIn, wards, contactPayload, revealErrors }
}
