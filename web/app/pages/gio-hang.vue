<script setup lang="ts">
import { CheckoutQuote, MAX_QUANTITY_PER_VARIANT, type CheckoutQuoteRequest } from '@ecommerce/shared'
import { Trash2, Truck } from 'lucide-vue-next'

// Giỏ chỉ có ở localStorage nên trang này báo giá sau khi mount, không qua SSR.
const cart = useCart()
const quote = ref<CheckoutQuote | null>(null)
const error = ref<string | null>(null)
let latest = 0

async function refreshQuote() {
  const lines = cart.lines.value.map(({ variantId, quantity }) => ({ variantId, quantity }))
  if (!lines.length) {
    quote.value = null
    return
  }
  // Đổi số lượng liên tiếp: chỉ nhận báo giá của lần gọi cuối.
  const call = ++latest
  try {
    const body: CheckoutQuoteRequest = { lines }
    const result = CheckoutQuote.parse(await $fetch('/api/checkout/quote', { method: 'POST', body }))
    if (call !== latest) return
    quote.value = result
    error.value = null
  } catch (err) {
    if (call === latest) error.value = apiErrorMessage(err)
  }
}
watch(cart.lines, refreshQuote, { deep: true })
watch(cart.ready, refreshQuote, { immediate: true })

const quoted = computed(() => new Map(quote.value?.lines.map((line) => [line.variantId, line])))
const changes = computed(() => (quote.value ? cartChanges(cart.lines.value, quote.value.lines) : new Map()))
const rows = computed(() =>
  cart.lines.value.flatMap((line) => {
    const current = quoted.value.get(line.variantId)
    return current ? [{ line, current, change: changes.value.get(line.variantId) }] : []
  }),
)
const priceChanged = computed(() => [...changes.value.values()].some((change) => change.kind === 'price'))
const unavailable = computed(() => [...changes.value.values()].some((change) => change.kind !== 'price'))
const canCheckout = computed(() => rows.value.length > 0 && changes.value.size === 0)

const QUANTITIES = Array.from({ length: MAX_QUANTITY_PER_VARIANT }, (_, i) => i + 1)
const attributesText = (attributes: Record<string, unknown> | null) =>
  attributes
    ? Object.values(attributes)
        .map((value) => (Array.isArray(value) ? value.join(', ') : String(value)))
        .join(' · ')
    : ''

useSeo({ title: 'Giỏ hàng', description: 'Các sản phẩm bạn đã chọn.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
    <h1>Giỏ hàng</h1>

    <p v-if="!cart.ready.value" class="mt-8 text-muted-foreground">Đang tải…</p>

    <div v-else-if="!cart.lines.value.length" class="mt-8 rounded-lg border border-border bg-card p-8 text-center">
      <p class="text-muted-foreground">Giỏ hàng đang trống.</p>
      <NuxtLink to="/" class="btn-primary mt-5">Tiếp tục mua sắm</NuxtLink>
    </div>

    <template v-else>
      <p v-if="error" class="notice-error mt-6" role="alert">
        {{ error }}
        <button type="button" class="link ml-2" @click="refreshQuote">Thử lại</button>
      </p>
      <p v-else-if="!quote" class="mt-8 text-muted-foreground">Đang tải…</p>

      <div v-if="quote" class="mt-8 grid gap-10 lg:grid-cols-12">
        <section class="lg:col-span-8" aria-label="Các dòng trong giỏ">
          <div
            v-if="priceChanged"
            class="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
            role="status"
          >
            <span>Giá của một số sản phẩm đã đổi từ lúc bạn thêm vào giỏ.</span>
            <button type="button" class="btn-outline h-9" @click="cart.acceptPrices(quote.lines)">
              Đồng ý giá mới
            </button>
          </div>

          <ul class="divide-y divide-border border-y border-border">
            <li
              v-for="{ line, current, change } in rows"
              :key="line.variantId"
              class="flex gap-4 py-5"
              data-testid="cart-line"
            >
              <img
                v-if="current.image"
                :src="imageSrc(current.image, 160)"
                :alt="current.image.alt || current.product?.name || ''"
                width="96"
                height="120"
                class="aspect-[4/5] w-20 flex-none rounded-md bg-secondary object-cover sm:w-24"
              />
              <div v-else class="aspect-[4/5] w-20 flex-none rounded-md bg-secondary sm:w-24" />

              <div class="flex min-w-0 flex-1 flex-col gap-2">
                <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div class="min-w-0">
                    <NuxtLink
                      v-if="current.product && current.sku"
                      :to="{ path: `/san-pham/${current.product.slug}`, query: { sku: current.sku } }"
                      class="font-medium hover:underline"
                      >{{ current.product.name }}</NuxtLink
                    >
                    <p v-else class="font-medium text-muted-foreground">Sản phẩm không còn bán</p>
                    <p v-if="current.attributes" class="mt-0.5 text-sm text-muted-foreground">
                      {{ attributesText(current.attributes) }}
                    </p>
                  </div>
                  <p v-if="current.price !== null" class="text-right font-semibold tabular-nums">
                    {{ formatVnd(current.price * line.quantity) }}
                    <span v-if="line.quantity > 1" class="block text-xs font-normal text-muted-foreground"
                      >{{ formatVnd(current.price) }} / cái</span
                    >
                  </p>
                </div>

                <p v-if="change?.kind === 'price'" class="text-sm font-medium text-amber-800" data-testid="line-change">
                  Giá đã đổi từ <s class="tabular-nums">{{ formatVnd(change.from) }}</s> thành
                  <span class="tabular-nums">{{ formatVnd(change.to) }}</span>
                </p>
                <p
                  v-else-if="change?.kind === 'discontinued'"
                  class="text-sm font-medium text-red-700"
                  data-testid="line-change"
                >
                  Ngừng bán, hãy bỏ khỏi giỏ
                </p>
                <p
                  v-else-if="change?.kind === 'out_of_stock'"
                  class="text-sm font-medium text-red-700"
                  data-testid="line-change"
                >
                  Hết hàng, hãy bỏ khỏi giỏ
                </p>

                <div class="mt-auto flex items-center gap-3">
                  <label class="flex items-center gap-2 text-sm">
                    <span class="text-muted-foreground">Số lượng</span>
                    <select
                      :value="line.quantity"
                      :disabled="current.discontinued"
                      class="h-10 rounded-md border border-input bg-card px-2 text-base sm:text-sm"
                      @change="cart.setQuantity(line.variantId, Number(($event.target as HTMLSelectElement).value))"
                    >
                      <option v-for="n in QUANTITIES" :key="n" :value="n">{{ n }}</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    class="inline-flex h-10 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    @click="cart.remove(line.variantId)"
                  >
                    <Trash2 class="h-4 w-4" aria-hidden="true" />
                    Bỏ<span class="sr-only"> {{ current.product?.name ?? 'sản phẩm này' }}</span>
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </section>

        <aside class="lg:col-span-4">
          <div class="rounded-lg border border-border bg-card p-6 lg:sticky lg:top-28">
            <h2>Tóm tắt</h2>
            <dl class="mt-4 space-y-2 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">Tổng tiền hàng</dt>
                <dd class="font-semibold tabular-nums" data-testid="subtotal">{{ formatVnd(quote.subtotal) }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">Phí giao</dt>
                <dd>Tính ở bước đặt mua</dd>
              </div>
            </dl>
            <p
              v-if="quote.freeShippingThreshold !== null && quote.subtotal < quote.freeShippingThreshold"
              class="mt-4 text-sm text-muted-foreground"
            >
              Mua thêm {{ formatVnd(quote.freeShippingThreshold - quote.subtotal) }} để được miễn phí giao.
            </p>
            <p v-if="quote.groundShippingOnly" class="mt-4 flex gap-2 text-sm text-muted-foreground">
              <Truck class="h-5 w-5 shrink-0" aria-hidden="true" />
              Giỏ có sản phẩm chỉ giao bằng đường bộ, thời gian giao lâu hơn.
            </p>

            <NuxtLink v-if="canCheckout" to="/dat-mua" class="btn-primary mt-6 w-full">Đặt mua</NuxtLink>
            <template v-else>
              <button type="button" class="btn-primary mt-6 w-full" disabled>Đặt mua</button>
              <p class="mt-3 text-sm text-muted-foreground">
                <template v-if="unavailable">Bỏ các dòng ngừng bán hoặc hết hàng để đặt mua.</template>
                <template v-else-if="priceChanged">Đồng ý giá mới để đặt mua.</template>
              </p>
            </template>
          </div>
        </aside>
      </div>
    </template>
  </main>
</template>
