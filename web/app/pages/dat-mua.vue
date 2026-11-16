<script setup lang="ts">
import {
  CheckoutConflictDetails,
  CheckoutQuote,
  CheckoutResult,
  PRIVACY_POLICY_SLUG,
  RESERVATION_MINUTES,
  type CheckoutLineChange,
  type CheckoutQuoteRequest,
  type CheckoutRequest,
  type VoucherConflict,
} from '@ecommerce/shared'
import { Truck } from 'lucide-vue-next'

// Giỏ ở localStorage và thông tin nhận hàng là dữ liệu cá nhân: trang chỉ có khung khi SSR, mọi thứ nạp sau khi mount.
const cart = useCart()
const quote = ref<CheckoutQuote | null>(null)
const quoteError = ref<string | null>(null)

const { form, invoice, invoiceOpen, acceptPrivacyPolicy, session, signedIn, wards, contactPayload, revealErrors } =
  useShippingForm()

/** Mã khách đang áp; gửi kèm mọi lần báo giá để tiền giảm theo đúng giỏ và tỉnh/thành. */
const voucherCode = ref<string | null>(null)
/** 409 về mã lúc đặt: hiện hộp chọn đặt tiếp không mã hay quay lại. */
const voucherConflict = ref<VoucherConflict | null>(null)

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
    const { provinceCode, email, phone } = form.value
    const body: CheckoutQuoteRequest = {
      lines,
      ...(provinceCode && { provinceCode }),
      // Email, số điện thoại để kiểm lượt mỗi khách; chưa nhập xong thì server bỏ qua.
      ...(voucherCode.value && { voucherCode: voucherCode.value, email, phone }),
    }
    const result = CheckoutQuote.parse(await $fetch('/api/checkout/quote', { method: 'POST', body }))
    if (call !== latest) return
    quote.value = result
    quoteError.value = null
  } catch (err) {
    if (call === latest) quoteError.value = apiErrorMessage(err)
  }
}
watch(cart.ready, refreshQuote, { immediate: true })
// `useShippingForm` xóa phường/xã khi đổi tỉnh/thành; ở đây chỉ tính lại phí giao.
watch(
  () => form.value.provinceCode,
  () => void refreshQuote(),
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

/** Đặt tiếp không dùng mã sau khi mã không còn dùng được lúc đặt. */
async function submitWithoutVoucher() {
  await removeVoucher()
  if (canSubmit.value) await submit()
}

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
    const voucher = quote.value?.voucher
    const body: CheckoutRequest = {
      lines: cart.lines.value.map(({ variantId, quantity, price }) => ({ variantId, quantity, price })),
      // Chỉ gửi mã đang áp được, kèm tiền giảm khách đã thấy.
      ...(voucher?.applied && { voucherCode: voucher.code, discount: voucher.discount }),
      ...contactPayload(),
      ...(!signedIn.value && { acceptPrivacyPolicy: acceptPrivacyPolicy.value }),
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
      // Mã không còn như khách đã thấy: không tự bỏ mã, khách tự chọn.
      voucherConflict.value = details.data.voucher ?? null
    }
    error.value = apiErrorMessage(err)
    fieldErrors.value = new Map(apiFieldErrors(err).map((f) => [f.path, f.message]))
    revealErrors(fieldErrors.value)
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
      <CheckoutContactFields
        v-model:form="form"
        v-model:invoice="invoice"
        v-model:invoice-open="invoiceOpen"
        class="lg:col-span-7"
        :wards="wards"
        :field-errors="fieldErrors"
      />

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

            <VoucherField :code="voucherCode" :result="quote.voucher" @apply="applyVoucher" @remove="removeVoucher" />

            <dl class="mt-4 space-y-2 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">Tổng tiền hàng</dt>
                <dd class="tabular-nums">{{ formatVnd(quote.subtotal) }}</dd>
              </div>
              <div v-if="quote.discount > 0" class="flex justify-between gap-4" data-testid="discount">
                <dt class="text-muted-foreground">
                  Mã giảm giá <span class="font-mono">{{ quote.voucher?.code }}</span>
                </dt>
                <dd class="tabular-nums">−{{ formatVnd(quote.discount) }}</dd>
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
              v-if="
                quote.freeShippingThreshold !== null && quote.subtotal - quote.discount < quote.freeShippingThreshold
              "
              class="mt-3 text-sm text-muted-foreground"
            >
              Mua thêm {{ formatVnd(quote.freeShippingThreshold - quote.subtotal + quote.discount) }} để được miễn phí
              giao<template v-if="quote.discount > 0"> (tính trên tiền hàng sau giảm)</template>.
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

          <div
            v-if="voucherConflict"
            class="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm"
            role="alertdialog"
            aria-labelledby="voucher-conflict-title"
            data-testid="voucher-conflict"
          >
            <p id="voucher-conflict-title" class="font-medium">
              {{ voucherReasonText(voucherConflict.reason, voucherConflict.shortfall) }}
              <template v-if="voucherConflict.discount !== null">
                : giảm {{ formatVnd(voucherConflict.discount) }}</template
              >
            </p>
            <p class="mt-1 text-muted-foreground">
              Tổng phải trả khi không dùng mã: {{ formatVnd(voucherConflict.totalWithoutVoucher) }}.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <button
                v-if="voucherConflict.reason !== 'changed'"
                type="button"
                class="btn-primary h-9 px-4"
                :disabled="submitting"
                @click="submitWithoutVoucher"
              >
                Đặt không dùng mã
              </button>
              <button type="button" class="btn-outline h-9 px-4" @click="voucherConflict = null">Quay lại</button>
            </div>
          </div>
          <p v-else-if="error" class="notice-error mt-4" role="alert">{{ error }}</p>
          <button type="submit" class="btn-primary mt-6 w-full" :disabled="!canSubmit">Đặt mua và thanh toán</button>
          <p class="mt-3 text-xs text-muted-foreground">
            Hàng được giữ cho bạn {{ RESERVATION_MINUTES }} phút sau khi đặt. Thanh toán qua VNPAY: thẻ ATM, thẻ quốc tế
            hoặc quét QR.
          </p>
        </div>
      </aside>
    </form>
  </main>
</template>
