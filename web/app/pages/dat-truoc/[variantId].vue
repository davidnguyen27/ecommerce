<script setup lang="ts">
import {
  CheckoutResult,
  MAX_QUANTITY_PER_VARIANT,
  PRIVACY_POLICY_SLUG,
  PreorderConflictDetails,
  PreorderQuote,
  RESERVATION_MINUTES,
  type PreorderChange,
  type PreorderQuoteRequest,
  type PreorderRequest,
} from '@ecommerce/shared'
import { Truck } from 'lucide-vue-next'

// Đặt trước một biến thể, không qua giỏ hàng (ADR 0012). Thông tin nhận hàng là dữ liệu cá nhân: trang chỉ có khung
// khi SSR, báo giá và form nạp sau khi mount.
const route = useRoute()
const variantId = String(route.params.variantId)
const quantity = ref(1)
const quote = ref<PreorderQuote | null>(null)
const quoteError = ref<string | null>(null)
const acceptPreorderPolicy = ref(false)

const { form, invoice, invoiceOpen, acceptPrivacyPolicy, session, signedIn, wards, contactPayload, revealErrors } =
  useShippingForm()

/** Thay đổi server báo khi đặt (409); báo giá đã được tải lại theo giá trị mới. */
const change = ref<PreorderChange | null>(null)

let latest = 0
async function refreshQuote() {
  // Đổi số lượng hay tỉnh/thành liên tiếp: chỉ nhận báo giá của lần gọi cuối.
  const call = ++latest
  try {
    const provinceCode = form.value.provinceCode
    const body: PreorderQuoteRequest = { variantId, quantity: quantity.value, ...(provinceCode && { provinceCode }) }
    const result = PreorderQuote.parse(await $fetch('/api/preorders/quote', { method: 'POST', body }))
    if (call !== latest) return
    quote.value = result
    quoteError.value = null
  } catch (err) {
    if (call === latest) quoteError.value = apiErrorMessage(err)
  }
}
onMounted(refreshQuote)
watch(
  () => [quantity.value, form.value.provinceCode],
  () => {
    change.value = null
    void refreshQuote()
  },
)

const CHANGE_TEXT: Record<PreorderChange['kind'], string> = {
  in_stock: 'Sản phẩm đã có hàng sẵn. Bạn có thể mua ngay ở trang sản phẩm.',
  price: 'Giá đã thay đổi. Hãy xem lại số tiền bên dưới rồi đặt lại.',
  deposit: 'Mức cọc đã thay đổi. Hãy xem lại số tiền bên dưới rồi đặt lại.',
  campaign: 'Đợt đặt trước đã thay đổi hoặc đã đóng. Hãy xem lại thời gian giao dự kiến.',
  sold_out: 'Không còn đủ suất đặt trước cho số lượng này.',
  discontinued: 'Sản phẩm không còn bán.',
}
const problem = computed(() => change.value ?? quote.value?.problem ?? null)
/** Đổi giá, mức cọc hay đợt thì báo giá mới đã có số mới: khách xem lại rồi đặt lại được. */
const blocking = computed(() => problem.value && !['price', 'deposit', 'campaign'].includes(problem.value.kind))

const submitting = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref(new Map<string, string>())
const canSubmit = computed(
  () =>
    !!quote.value?.offer &&
    quote.value.price !== null &&
    quote.value.preorderPolicy !== null &&
    !quote.value.problem &&
    !blocking.value &&
    signedIn.value !== null &&
    !submitting.value,
)

async function submit() {
  const current = quote.value
  if (!current?.offer || current.price === null) return
  submitting.value = true
  error.value = null
  fieldErrors.value = new Map()
  try {
    const body: PreorderRequest = {
      variantId,
      quantity: quantity.value,
      campaignId: current.offer.campaignId,
      price: current.price,
      depositPercent: current.offer.depositPercent,
      ...contactPayload(),
      ...(!signedIn.value && { acceptPrivacyPolicy: acceptPrivacyPolicy.value }),
      acceptPreorderPolicy: acceptPreorderPolicy.value,
    }
    const result = CheckoutResult.parse(await session.optionalAuthFetch('/api/preorders', { method: 'POST', body }))
    rememberOrderToken(result.code, result.token)
    window.location.assign(result.checkoutUrl)
  } catch (err) {
    // Phiên đăng nhập hết hạn giữa chừng: đặt như khách vãng lai, cần tick đồng ý.
    if (isUnauthorized(err)) signedIn.value = false
    const details = PreorderConflictDetails.safeParse(apiErrorDetails(err))
    if (details.success) {
      await refreshQuote()
      change.value = details.data.change
    }
    error.value = apiErrorMessage(err)
    fieldErrors.value = new Map(apiFieldErrors(err).map((f) => [f.path, f.message]))
    revealErrors(fieldErrors.value)
    submitting.value = false
  }
}

useSeo({ title: 'Đặt trước', description: 'Đặt trước sản phẩm chưa có hàng.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
    <h1>Đặt trước</h1>

    <p v-if="quoteError && !quote" class="notice-error mt-8" role="alert">
      {{ quoteError }}
      <button type="button" class="link ml-2" @click="refreshQuote">Thử lại</button>
    </p>
    <p v-else-if="!quote" class="mt-8 text-muted-foreground">Đang tải…</p>

    <div
      v-else-if="!quote.product || !quote.offer"
      class="mt-8 rounded-lg border border-border bg-card p-8 text-center"
      data-testid="preorder-unavailable"
    >
      <p class="text-muted-foreground">
        {{
          quote.problem?.kind === 'in_stock'
            ? CHANGE_TEXT.in_stock
            : quote.product
              ? 'Sản phẩm này hiện không nhận đặt trước.'
              : CHANGE_TEXT.discontinued
        }}
      </p>
      <NuxtLink v-if="quote.product" :to="`/san-pham/${quote.product.slug}`" class="btn-primary mt-5">
        Xem sản phẩm
      </NuxtLink>
      <NuxtLink v-else to="/" class="btn-primary mt-5">Tiếp tục mua sắm</NuxtLink>
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
          <h2>Đơn đặt trước</h2>
          <div class="mt-4 flex gap-4 border-y border-border py-4 text-sm">
            <img
              v-if="quote.image"
              :src="imageSrc(quote.image, 160)"
              :alt="quote.image.alt || quote.product.name"
              width="80"
              height="100"
              class="aspect-[4/5] w-16 flex-none rounded-md bg-secondary object-cover"
            />
            <div class="min-w-0 flex-1">
              <NuxtLink :to="`/san-pham/${quote.product.slug}`" class="font-medium hover:underline">
                {{ quote.product.name }}
              </NuxtLink>
              <p v-if="quote.attributes" class="text-muted-foreground">
                {{ variantAttributesText(quote.attributes) }} · SKU {{ quote.sku }}
              </p>
              <p v-if="quote.price !== null" class="tabular-nums">{{ formatVnd(quote.price) }}</p>
              <label class="mt-2 flex items-center gap-2">
                Số lượng
                <select v-model.number="quantity" class="field-input h-9 w-20" name="quantity">
                  <option v-for="n in MAX_QUANTITY_PER_VARIANT" :key="n" :value="n">{{ n }}</option>
                </select>
              </label>
            </div>
          </div>

          <p class="mt-4 text-sm" data-testid="preorder-delivery">
            Giao dự kiến
            <strong class="tabular-nums"
              >{{ formatDateOnly(quote.offer.deliveryFrom) }} – {{ formatDateOnly(quote.offer.deliveryTo) }}</strong
            >. Khi hàng về, bạn có {{ quote.offer.remainderDays }} ngày để trả phần còn lại.
          </p>

          <dl class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Tổng tiền hàng</dt>
              <dd class="tabular-nums">{{ quote.subtotal === null ? '—' : formatVnd(quote.subtotal) }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Phí giao</dt>
              <dd class="tabular-nums" data-testid="shipping-fee">
                <template v-if="quote.shippingFee === null">Chọn tỉnh/thành</template>
                <template v-else-if="quote.shippingFee === 0">Miễn phí</template>
                <template v-else>{{ formatVnd(quote.shippingFee) }}</template>
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Tổng phải trả</dt>
              <dd class="tabular-nums" data-testid="total">
                {{ quote.total === null ? '—' : formatVnd(quote.total) }}
              </dd>
            </div>
            <div class="flex justify-between gap-4 text-base">
              <dt class="font-semibold">Cọc ngay ({{ quote.offer.depositPercent }}%)</dt>
              <dd class="font-semibold tabular-nums" data-testid="deposit">
                {{ quote.depositAmount === null ? '—' : formatVnd(quote.depositAmount) }}
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-muted-foreground">Còn lại khi hàng về</dt>
              <dd class="tabular-nums" data-testid="remaining">
                {{ quote.remainingAmount === null ? '—' : formatVnd(quote.remainingAmount) }}
              </dd>
            </div>
          </dl>
          <p v-if="quote.groundShippingOnly" class="mt-3 flex gap-2 text-sm text-muted-foreground">
            <Truck class="h-5 w-5 shrink-0" aria-hidden="true" />
            Sản phẩm chỉ giao bằng đường bộ, thời gian giao lâu hơn.
          </p>
          <div v-if="quote.policies.length" class="mt-4 text-sm">
            <p class="text-muted-foreground">Chính sách áp dụng cho đơn này:</p>
            <ul class="mt-1 space-y-1">
              <li v-for="p in quote.policies" :key="p.slug">
                <NuxtLink :to="`/trang/${p.slug}`" target="_blank" class="link">{{ p.title }}</NuxtLink>
              </li>
            </ul>
          </div>

          <p v-if="problem" class="notice-error mt-4" role="status" data-testid="preorder-change">
            {{ CHANGE_TEXT[problem.kind] }}
          </p>

          <p v-if="!quote.preorderPolicy" class="notice-error mt-4" role="status">
            Cửa hàng chưa công bố chính sách đặt trước nên chưa nhận đặt trước. Vui lòng quay lại sau.
          </p>
          <label v-else class="mt-5 flex items-start gap-3 text-sm leading-6">
            <input
              v-model="acceptPreorderPolicy"
              type="checkbox"
              name="acceptPreorderPolicy"
              required
              class="mt-1 h-4 w-4 shrink-0 accent-primary"
            />
            <span>
              Tôi đã đọc và đồng ý với
              <NuxtLink :to="`/trang/${quote.preorderPolicy.slug}`" target="_blank" class="link">{{
                quote.preorderPolicy.title.toLowerCase()
              }}</NuxtLink>
              (điều kiện cọc, hủy/hoàn và hạn trả phần còn lại)
              <span v-if="fieldErrors.get('acceptPreorderPolicy')" class="block text-red-700">{{
                fieldErrors.get('acceptPreorderPolicy')
              }}</span>
            </span>
          </label>

          <label v-if="signedIn === false" class="mt-3 flex items-start gap-3 text-sm leading-6">
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

          <p v-if="error && !problem" class="notice-error mt-4" role="alert">{{ error }}</p>
          <button type="submit" class="btn-primary mt-6 w-full" :disabled="!canSubmit">Đặt trước và trả cọc</button>
          <p class="mt-3 text-xs text-muted-foreground">
            Suất đặt trước được giữ cho bạn {{ RESERVATION_MINUTES }} phút để trả cọc qua VNPAY: thẻ ATM, thẻ quốc tế
            hoặc quét QR.
          </p>
        </div>
      </aside>
    </form>
  </main>
</template>
