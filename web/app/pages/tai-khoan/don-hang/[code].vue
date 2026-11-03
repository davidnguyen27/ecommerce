<script setup lang="ts">
import { PublicOrder } from '@ecommerce/shared'

// Đơn trong tài khoản: phiên khách chỉ có ở trình duyệt nên đơn nạp sau khi mount, HTML từ server không có gì của đơn.
const route = useRoute()
const code = computed(() => String(route.params.code))
const session = useCustomerSession()
const order = ref<PublicOrder | null>(null)
const error = ref<string | null>(null)

async function load() {
  if (!(await session.signedIn())) return void (await navigateTo('/dang-nhap'))
  try {
    order.value = PublicOrder.parse(await session.accountFetch(`/api/account/orders/${encodeURIComponent(code.value)}`))
    error.value = null
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}
onMounted(load)

useSeo({ title: () => `Đơn hàng #${code.value}`, description: 'Thông tin đơn hàng của bạn.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
    <NuxtLink to="/tai-khoan" class="link text-sm">← Tài khoản</NuxtLink>
    <h1 class="mt-2">Đơn hàng #{{ code }}</h1>
    <p v-if="error" class="notice-error mt-8" role="alert">{{ error }}</p>
    <p v-else-if="!order" class="mt-8 text-muted-foreground">Đang tải…</p>
    <OrderView v-else :order="order" class="mt-8" />
  </main>
</template>
