import { LastShippingAddress, type InvoiceInfo, type ShippingAddress } from '@ecommerce/shared'
import type { Ward } from '@ecommerce/shared/wards'

export type ShippingFormFields = Required<{ [K in keyof ShippingAddress]: string }> & { note: string }
export type InvoiceFields = { [K in keyof InvoiceInfo]: string }

/**
 * Shipping info shared by checkout and pre-order: address, note, company invoice, privacy consent box (guests only).
 * Signed-in customers get their previous address prefilled. The ward list is heavy, so it loads only in the browser.
 * Everything runs after mount: this is personal data, and SSR renders only the frame.
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
  // The invoice section is collapsed by default; it opens when the server reports an error on its fields.
  const invoiceOpen = ref(false)
  const acceptPrivacyPolicy = ref(false)

  // Signed-in customers consented at sign-up, so the consent box shows only for guests.
  const session = useCustomerSession()
  const signedIn = ref<boolean | null>(null)
  onMounted(async () => {
    signedIn.value = await session.signedIn()
    if (signedIn.value) await fillLastAddress()
  })

  /** Signed-in customers: prefill the previous address, only if they have not typed anything yet. */
  async function fillLastAddress() {
    try {
      const { address } = LastShippingAddress.parse(await session.accountFetch('/api/account/shipping-address'))
      const f = form.value
      const untouched = [f.recipientName, f.phone, f.email, f.provinceCode, f.streetAddress].every((v) => v === '')
      if (!address || !untouched) return
      const { wardCode, ...rest } = address
      Object.assign(form.value, rest)
      // Changing the province makes the watcher clear the ward; wait for it before filling.
      await nextTick()
      form.value.wardCode = wardCode
    } catch {
      // If prefilling fails, the customer just types as usual.
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

  /**
   * Address, note and invoice sent to the API. An empty invoice is not sent; a partial one is, so the server reports
   * gaps.
   */
  function contactPayload() {
    const { note, ...address } = form.value
    const wantsInvoice = Object.values(invoice.value).some((value) => value.trim() !== '')
    return { address, note, ...(wantsInvoice && { invoice: { ...invoice.value } }) }
  }

  /** When the server reports an invoice field error, open the invoice section so the customer sees it. */
  function revealErrors(fieldErrors: Map<string, string>) {
    if ([...fieldErrors.keys()].some((path) => path.startsWith('invoice.'))) invoiceOpen.value = true
  }

  return { form, invoice, invoiceOpen, acceptPrivacyPolicy, session, signedIn, wards, contactPayload, revealErrors }
}
