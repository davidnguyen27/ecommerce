<script setup lang="ts">
import {
  CheckoutConflictDetails,
  CheckoutQuote,
  CheckoutResult,
  LastShippingAddress,
  PRIVACY_POLICY_SLUG,
  PROVINCES,
  RESERVATION_MINUTES,
  type CheckoutLineChange,
  type CheckoutQuoteRequest,
  type CheckoutRequest,
} from '@ecommerce/shared'
import type { Ward } from '@ecommerce/shared/wards'
import { Truck } from 'lucide-vue-next'

// Giỏ ở localStorage và thông tin nhận hàng là dữ liệu cá nhân: trang chỉ có khung khi SSR, mọi thứ nạp sau khi mount.
const cart = useCart()
const quote = ref<CheckoutQuote | null>(null)
const quoteError = ref<string | null>(null)

const form = reactive({
  recipientName: '',
  phone: '',
  email: '',
  provinceCode: '',
  wardCode: '',
  streetAddress: '',
  note: '',
})
const acceptPrivacyPolicy = ref(false)
const invoice = reactive({ companyName: '', taxCode: '', address: '' })
// Phần hóa đơn thu gọn mặc định; mở ra khi server báo lỗi ở trường của nó.
const invoiceOpen = ref(false)

// Khách đã đăng nhập đồng ý chính sách bảo mật lúc đăng ký, nên ô đồng ý chỉ hiện cho khách vãng lai.
const session = useCustomerSession()
const signedIn = ref<boolean | null>(null)
onMounted(async () => {
  signedIn.value = await session.signedIn()
  if (signedIn.value) await fillLastAddress()
})

/** Khách đã đăng nhập: điền sẵn địa chỉ lần đặt mua trước, chỉ khi khách chưa gõ gì vào form. */
async function fillLastAddress() {
  try {
    const { address } = LastShippingAddress.parse(await session.accountFetch('/api/account/shipping-address'))
    const untouched = [form.recipientName, form.phone, form.email, form.provinceCode, form.streetAddress].every(
      (value) => value === '',
    )
    if (!address || !untouched) return
    const { wardCode, ...rest } = address
    Object.assign(form, rest)
    // Đổi tỉnh/thành thì watcher xóa phường/xã; đợi watcher chạy xong rồi mới điền.
    await nextTick()
    form.wardCode = wardCode
  } catch {
    // Không điền được thì khách tự nhập như bình thường.
  }
}

// Danh mục phường/xã nặng, nên chỉ nạp ở trang này và chỉ ở trình duyệt.
const wardsOf = shallowRef<((provinceCode: string) => Ward[]) | null>(null)
onMounted(async () => {
  wardsOf.value = (await import('@ecommerce/shared/wards')).wardsOf
})
const wards = computed(() => (wardsOf.value && form.provinceCode ? wardsOf.value(form.provinceCode) : []))

let latest = 0
async function refreshQuote() {
  const lines = cart.lines.value.map(({ variantId, quantity }) => ({ variantId, quantity }))
  if (!lines.length) {
    quote.value = null
    return
  }
  // Đổi tỉnh/thành liên tiếp: chỉ nhận báo giá của lần gọi cuối.
  const call = ++latest
  try {
    const body: CheckoutQuoteRequest = { lines, ...(form.provinceCode && { provinceCode: form.provinceCode }) }
    const result = CheckoutQuote.parse(await $fetch('/api/checkout/quote', { method: 'POST', body }))
    if (call !== latest) return
    quote.value = result
    quoteError.value = null
  } catch (err) {
    if (call === latest) quoteError.value = apiErrorMessage(err)
  }
}
watch(cart.ready, refreshQuote, { immediate: true })
watch(
  () => form.provinceCode,
  () => {
    form.wardCode = ''
    void refreshQuote()
  },
)

/** Thay đổi server báo khi đặt mua (409), theo variant id; giỏ đổi thì khách đã xử lý, bỏ đi. */
const conflicts = ref(new Map<string, CheckoutLineChange>())
watch(
  cart.lines,
  () => {
    conflicts.value = new Map()
    void refreshQuote()
  },
  { deep: true },
)

const quoted = computed(() => new Map(quote.value?.lines.map((line) => [line.variantId, line])))
const changes = computed(() => {
  const found = new Map<string, CheckoutLineChange>(quote.value ? cartChanges(cart.lines.value, quote.value.lines) : [])
  for (const [variantId, change] of conflicts.value) if (!found.has(variantId)) found.set(variantId, change)
  return found
})
const priceChanged = computed(() => [...changes.value.values()].some((change) => change.kind === 'price'))
const rows = computed(() =>
  cart.lines.value.flatMap((line) => {
    const current = quoted.value.get(line.variantId)
    return current ? [{ line, current, change: changes.value.get(line.variantId) }] : []
  }),
)

const submitting = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref(new Map<string, string>())
const canSubmit = computed(
  () => rows.value.length > 0 && changes.value.size === 0 && signedIn.value !== null && !submitting.value,
)

function acceptPrices() {
  if (quote.value) cart.acceptPrices(quote.value.lines)
}

async function submit() {
  submitting.value = true
  error.value = null
  fieldErrors.value = new Map()
  try {
    const { note, ...address } = form
    // Phần hóa đơn bỏ trống thì không gửi; điền dở thì gửi để server báo trường còn thiếu.
    const wantsInvoice = Object.values(invoice).some((value) => value.trim() !== '')
    const body: CheckoutRequest = {
      lines: cart.lines.value.map(({ variantId, quantity, price }) => ({ variantId, quantity, price })),
      address,
      note,
      ...(!signedIn.value && { acceptPrivacyPolicy: acceptPrivacyPolicy.value }),
      ...(wantsInvoice && { invoice: { ...invoice } }),
    }
    const result = CheckoutResult.parse(await session.optionalAuthFetch('/api/checkout', { method: 'POST', body }))
    cart.clear()
    rememberOrderToken(result.code, result.token)
    window.location.assign(result.checkoutUrl)
  } catch (err) {
    // Phiên đăng nhập hết hạn giữa chừng: đặt như khách vãng lai, cần tick đồng ý.
    if (isUnauthorized(err)) signedIn.value = false
    const details = CheckoutConflictDetails.safeParse(apiErrorDetails(err))
    if (details.success) {
      // Giá, ngừng bán hay hết hàng đã đổi: hiện thay đổi từng dòng, khách phải xác nhận lại.
      await refreshQuote()
      conflicts.value = new Map(details.data.lines.map((line) => [line.variantId, line.change]))
    }
    error.value = apiErrorMessage(err)
    fieldErrors.value = new Map(apiFieldErrors(err).map((f) => [f.path, f.message]))
    if ([...fieldErrors.value.keys()].some((path) => path.startsWith('invoice.'))) invoiceOpen.value = true
    submitting.value = false
  }
}

useSeo({ title: 'Đặt mua', description: 'Thông tin nhận hàng và xác nhận đơn.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
    <h1>Đặt mua</h1>

    <p v-if="!cart.ready.value" class="mt-8 text-muted-foreground">Đang tải…</p>

    <div v-else-if="!cart.lines.value.length" class="mt-8 rounded-lg border border-border bg-card p-8 text-center">
      <p class="text-muted-foreground">Giỏ hàng đang trống.</p>
      <NuxtLink to="/" class="btn-primary mt-5">Tiếp tục mua sắm</NuxtLink>
    </div>

    <form v-else class="mt-8 grid gap-10 lg:grid-cols-12" @submit.prevent="submit">
      <section class="space-y-5 lg:col-span-7" aria-label="Thông tin nhận hàng">
        <h2>Thông tin nhận hàng</h2>
        <label class="field">
          Họ tên người nhận
          <input v-model="form.recipientName" class="field-input" name="name" autocomplete="name" required />
          <span v-if="fieldErrors.get('address.recipientName')" class="text-sm text-red-700">{{
            fieldErrors.get('address.recipientName')
          }}</span>
        </label>
        <div class="grid gap-5 sm:grid-cols-2">
          <label class="field">
            Số điện thoại
            <input
              v-model="form.phone"
              class="field-input"
              type="tel"
              name="tel"
              autocomplete="tel"
              inputmode="tel"
              required
            />
            <span v-if="fieldErrors.get('address.phone')" class="text-sm text-red-700">{{
              fieldErrors.get('address.phone')
            }}</span>
          </label>
          <label class="field">
            Email
            <input
              v-model="form.email"
              class="field-input"
              type="email"
              name="email"
              autocomplete="email"
              inputmode="email"
              required
            />
            <span v-if="fieldErrors.get('address.email')" class="text-sm text-red-700">{{
              fieldErrors.get('address.email')
            }}</span>
          </label>
        </div>
        <div class="grid gap-5 sm:grid-cols-2">
          <!-- Label tách khỏi select: bọc thì tên truy cập của ô lẫn chữ của các option. -->
          <div class="field">
            <label for="checkout-province">Tỉnh/thành</label>
            <select id="checkout-province" v-model="form.provinceCode" class="field-input" name="province" required>
              <option value="" disabled>Chọn tỉnh/thành</option>
              <option v-for="p in PROVINCES" :key="p.code" :value="p.code">{{ p.name }}</option>
            </select>
          </div>
          <div class="field">
            <label for="checkout-ward">Phường/xã</label>
            <select
              id="checkout-ward"
              v-model="form.wardCode"
              class="field-input"
              name="ward"
              required
              :disabled="!wards.length"
            >
              <option value="" disabled>{{ form.provinceCode ? 'Chọn phường/xã' : 'Chọn tỉnh/thành trước' }}</option>
              <option v-for="w in wards" :key="w.code" :value="w.code">{{ w.name }}</option>
            </select>
            <span v-if="fieldErrors.get('address.wardCode')" class="text-sm text-red-700">{{
              fieldErrors.get('address.wardCode')
            }}</span>
          </div>
        </div>
        <label class="field">
          Số nhà, tên đường
          <input v-model="form.streetAddress" class="field-input" name="street" autocomplete="address-line1" required />
        </label>
        <label class="field">
          Ghi chú cho đơn (không bắt buộc)
          <textarea v-model="form.note" class="field-input min-h-24 py-2" name="note" maxlength="1000" />
        </label>

        <details
          class="rounded-lg border border-border bg-card"
          data-testid="invoice"
          :open="invoiceOpen"
          @toggle="invoiceOpen = ($event.target as HTMLDetailsElement).open"
        >
          <summary class="cursor-pointer px-5 py-4 font-medium">Xuất hóa đơn công ty (không bắt buộc)</summary>
          <div class="space-y-5 px-5 pb-5">
            <label class="field">
              Tên công ty
              <input v-model="invoice.companyName" class="field-input" name="companyName" autocomplete="organization" />
              <span v-if="fieldErrors.get('invoice.companyName')" class="text-sm text-red-700">{{
                fieldErrors.get('invoice.companyName')
              }}</span>
            </label>
            <label class="field">
              Mã số thuế
              <input
                v-model="invoice.taxCode"
                class="field-input"
                name="taxCode"
                inputmode="numeric"
                placeholder="0101234567 hoặc 0101234567-001"
              />
              <span v-if="fieldErrors.get('invoice.taxCode')" class="text-sm text-red-700">{{
                fieldErrors.get('invoice.taxCode')
              }}</span>
            </label>
            <label class="field">
              Địa chỉ xuất hóa đơn
              <input v-model="invoice.address" class="field-input" name="invoiceAddress" />
              <span v-if="fieldErrors.get('invoice.address')" class="text-sm text-red-700">{{
                fieldErrors.get('invoice.address')
              }}</span>
            </label>
          </div>
        </details>
      </section>

      <aside class="lg:col-span-5">
        <div class="rounded-lg border border-border bg-card p-6 lg:sticky lg:top-28">
          <h2>Đơn hàng</h2>
          <p v-if="quoteError" class="notice-error mt-4" role="alert">
            {{ quoteError }}
            <button type="button" class="link ml-2" @click="refreshQuote">Thử lại</button>
          </p>
          <p v-else-if="!quote" class="mt-4 text-muted-foreground">Đang tải…</p>

          <template v-if="quote">
            <ul class="mt-4 divide-y divide-border border-y border-border text-sm">
              <li
                v-for="{ line, current, change } in rows"
                :key="line.variantId"
                class="py-3"
                data-testid="checkout-line"
              >
                <div class="flex justify-between gap-4">
                  <span class="min-w-0">
                    {{ current.product?.name ?? 'Sản phẩm không còn bán' }}
                    <span v-if="current.attributes" class="block text-muted-foreground">
                      {{ variantAttributesText(current.attributes) }} · {{ line.quantity }} cái
                    </span>
                  </span>
                  <span v-if="current.price !== null" class="tabular-nums">{{
                    formatVnd(current.price * line.quantity)
                  }}</span>
                </div>
                <p v-if="change?.kind === 'price'" class="mt-1 font-medium text-amber-800" data-testid="line-change">
                  Giá đã đổi từ <s class="tabular-nums">{{ formatVnd(change.from) }}</s> thành
                  <span class="tabular-nums">{{ formatVnd(change.to) }}</span>
                </p>
                <p
                  v-else-if="change?.kind === 'discontinued'"
                  class="mt-1 font-medium text-red-700"
                  data-testid="line-change"
                >
                  Ngừng bán, hãy bỏ khỏi giỏ
                </p>
                <p
                  v-else-if="change?.kind === 'out_of_stock'"
                  class="mt-1 font-medium text-red-700"
                  data-testid="line-change"
                >
                  Không còn đủ hàng, hãy giảm số lượng hoặc bỏ khỏi giỏ
                </p>
              </li>
            </ul>

            <div v-if="changes.size" class="mt-4 space-y-3 text-sm" role="status">
              <button v-if="priceChanged" type="button" class="btn-outline h-9 w-full" @click="acceptPrices">
                Đồng ý giá mới
              </button>
              <NuxtLink to="/gio-hang" class="link block text-center">Sửa giỏ hàng</NuxtLink>
            </div>

            <dl class="mt-4 space-y-2 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">Tổng tiền hàng</dt>
                <dd class="tabular-nums">{{ formatVnd(quote.subtotal) }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">Phí giao</dt>
                <dd class="tabular-nums" data-testid="shipping-fee">
                  <template v-if="quote.shippingFee === null">Chọn tỉnh/thành</template>
                  <template v-else-if="quote.shippingFee === 0">Miễn phí</template>
                  <template v-else>{{ formatVnd(quote.shippingFee) }}</template>
                </dd>
              </div>
              <div class="flex justify-between gap-4 text-base">
                <dt class="font-semibold">Tổng phải trả</dt>
                <dd class="font-semibold tabular-nums" data-testid="total">
                  {{ quote.total === null ? '—' : formatVnd(quote.total) }}
                </dd>
              </div>
            </dl>
            <p
              v-if="quote.freeShippingThreshold !== null && quote.subtotal < quote.freeShippingThreshold"
              class="mt-3 text-sm text-muted-foreground"
            >
              Mua thêm {{ formatVnd(quote.freeShippingThreshold - quote.subtotal) }} để được miễn phí giao.
            </p>
            <p v-if="quote.groundShippingOnly" class="mt-3 flex gap-2 text-sm text-muted-foreground">
              <Truck class="h-5 w-5 shrink-0" aria-hidden="true" />
              Đơn có sản phẩm chỉ giao bằng đường bộ, thời gian giao lâu hơn.
            </p>
            <div v-if="quote.policies.length" class="mt-4 text-sm" data-testid="checkout-policies">
              <p class="text-muted-foreground">Chính sách áp dụng cho đơn này:</p>
              <ul class="mt-1 space-y-1">
                <li v-for="p in quote.policies" :key="p.slug">
                  <NuxtLink :to="`/trang/${p.slug}`" target="_blank" class="link">{{ p.title }}</NuxtLink>
                </li>
              </ul>
            </div>
          </template>

          <label v-if="signedIn === false" class="mt-5 flex items-start gap-3 text-sm leading-6">
            <input
              v-model="acceptPrivacyPolicy"
              type="checkbox"
              name="acceptPrivacyPolicy"
              required
              class="mt-1 h-4 w-4 shrink-0 accent-primary"
            />
            <span>
              Tôi đồng ý với
              <NuxtLink :to="`/trang/${PRIVACY_POLICY_SLUG}`" target="_blank" class="link">chính sách bảo mật</NuxtLink>
              về xử lý dữ liệu cá nhân
              <span v-if="fieldErrors.get('acceptPrivacyPolicy')" class="block text-red-700">{{
                fieldErrors.get('acceptPrivacyPolicy')
              }}</span>
            </span>
          </label>

          <p v-if="error" class="notice-error mt-4" role="alert">{{ error }}</p>
          <button type="submit" class="btn-primary mt-6 w-full" :disabled="!canSubmit">Đặt mua và thanh toán</button>
          <p class="mt-3 text-xs text-muted-foreground">
            Hàng được giữ cho bạn {{ RESERVATION_MINUTES }} phút sau khi đặt. Thanh toán bằng chuyển khoản qua mã
            VietQR.
          </p>
        </div>
      </aside>
    </form>
  </main>
</template>
