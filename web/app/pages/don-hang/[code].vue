<script setup lang="ts">
import { PublicOrder } from '@ecommerce/shared'

// Đơn là dữ liệu cá nhân, mở bằng token trong link: chỉ nạp ở trình duyệt, HTML từ server không có gì của đơn.
const route = useRoute()
const code = computed(() => String(route.params.code))
const order = ref<PublicOrder | null>(null)
const error = ref<string | null>(null)

async function load() {
  const token = typeof route.query.token === 'string' ? route.query.token : ''
  try {
    order.value = PublicOrder.parse(await $fetch(`/api/orders/${encodeURIComponent(code.value)}`, { query: { token } }))
    error.value = null
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}
onMounted(load)

// Token nằm trong URL: không gửi URL này cho trang khác qua Referer.
useHead({ meta: [{ name: 'referrer', content: 'no-referrer' }] })
useSeo({ title: () => `Đơn hàng #${code.value}`, description: 'Thông tin đơn hàng của bạn.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
    <h1>Đơn hàng #{{ code }}</h1>
    <p v-if="error" class="notice-error mt-8" role="alert">{{ error }}</p>
    <p v-else-if="!order" class="mt-8 text-muted-foreground">Đang tải…</p>
    <OrderView v-else :order="order" class="mt-8" />
  </main>
</template>
