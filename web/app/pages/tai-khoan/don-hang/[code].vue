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

// Khách hủy đơn chưa thanh toán của chính mình; lỗi (ví dụ đơn vừa được thanh toán) thì nạp lại để thấy trạng thái mới.
const cancelling = ref(false)
const cancelError = ref<string | null>(null)
async function cancel() {
  cancelling.value = true
  cancelError.value = null
  try {
    await session.accountFetch(`/api/account/orders/${encodeURIComponent(code.value)}/cancel`, { method: 'POST' })
  } catch (err) {
    cancelError.value = apiErrorMessage(err)
  } finally {
    await load()
    cancelling.value = false
  }
}

useSeo({ title: () => `Đơn hàng #${code.value}`, description: 'Thông tin đơn hàng của bạn.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
    <NuxtLink to="/tai-khoan" class="link text-sm">← Tài khoản</NuxtLink>
    <h1 class="mt-2">Đơn hàng #{{ code }}</h1>
    <p v-if="error" class="notice-error mt-8" role="alert">{{ error }}</p>
    <p v-else-if="!order" class="mt-8 text-muted-foreground">Đang tải…</p>
    <template v-else>
      <p v-if="cancelError" class="notice-error mt-8" role="alert">{{ cancelError }}</p>
      <OrderView :order="order" class="mt-8" cancellable :cancelling="cancelling" @cancel="cancel" />
    </template>
  </main>
</template>
