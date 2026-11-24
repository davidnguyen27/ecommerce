<script setup lang="ts">
import { PayRemainderResult, PublicOrder, canRequestCancel } from '@ecommerce/shared'

// Account order: the customer session exists only in the browser, so the order loads after mount; server HTML has none
// of it.
const route = useRoute()
const code = computed(() => String(route.params.code))
const session = useCustomerSession()
const supportClient = accountSupportClient(session.accountFetch)
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

// The customer cancels their own unpaid order; on error (e.g. just paid) reload to see the new status.
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

// Pay a pre-order's remainder: the API also issues a lookup token so the result page can open the order on return.
const payingRemainder = ref(false)
async function payRemainder() {
  payingRemainder.value = true
  cancelError.value = null
  try {
    const result = PayRemainderResult.parse(
      await session.accountFetch(`/api/account/orders/${encodeURIComponent(code.value)}/pay-remainder`, {
        method: 'POST',
      }),
    )
    if (result.token) rememberOrderToken(Number(code.value), result.token)
    window.location.assign(result.checkoutUrl)
  } catch (err) {
    cancelError.value = apiErrorMessage(err)
    payingRemainder.value = false
    await load()
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
      <OrderView
        :order="order"
        class="mt-8"
        cancellable
        :cancelling="cancelling"
        :paying-remainder="payingRemainder"
        @cancel="cancel"
        @pay-remainder="payRemainder"
      />
      <SupportRequests
        :client="supportClient"
        :order-code="Number(code)"
        :can-cancel="canRequestCancel(order)"
        :return-lines="
          order.status === 'completed' && order.fulfillmentStatus === 'delivered' ? order.lines : undefined
        "
        class="mt-8"
      />
    </template>
  </main>
</template>
