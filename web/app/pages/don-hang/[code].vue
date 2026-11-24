<script setup lang="ts">
import { PayRemainderResult, PublicOrder, canRequestCancel } from '@ecommerce/shared'

// Orders are personal data opened by token: loaded only in the browser, server HTML has nothing of the order.
// Two entries: the email link (`?token=…`), or the result page when the gateway sends the customer back (`?ket-qua=1`,
// no token in the URL; the token comes from the checkout tab's sessionStorage).
const route = useRoute()
const code = computed(() => String(route.params.code))
const isResult = computed(() => route.query['ket-qua'] === '1')
const order = ref<PublicOrder | null>(null)
const error = ref<string | null>(null)
const missingToken = ref(false)
const checking = ref(false)

// The order's support requests go with the lookup token (spec M6b).
const supportClient = computed(() => {
  const token = lookupToken()
  return token ? guestSupportClient(Number(code.value), token) : null
})

function lookupToken() {
  return typeof route.query.token === 'string' ? route.query.token : recallOrderToken(code.value)
}

async function load() {
  const token = lookupToken()
  if (!token) {
    missingToken.value = true
    return
  }
  checking.value = true
  try {
    // The result page asks the gateway before returning the order, in case the gateway's notice is late.
    const query = isResult.value ? { token, refresh: '1' } : { token }
    order.value = PublicOrder.parse(await $fetch(`/api/orders/${encodeURIComponent(code.value)}`, { query }))
    error.value = null
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    checking.value = false
  }
}
// VNPAY returns the customer with a signed result (`vnp_*`) in the URL: forward it to the API to verify and record
// (ADR 0010), no order token needed; then strip it so reloads and shared links do not carry it. On error `refresh=1`
// still tries.
async function forwardGatewayResult() {
  const entries = Object.entries(route.query)
  const signed = Object.fromEntries(
    entries.filter(([key, value]) => key.startsWith('vnp_') && typeof value === 'string'),
  )
  if (!isResult.value || !('vnp_SecureHash' in signed)) return
  try {
    await $fetch('/api/payments/vnpay/return', { method: 'POST', body: signed })
  } catch {
    // IPN, gateway queries and the expiry job are the fallbacks.
  }
  await navigateTo({ query: Object.fromEntries(entries.filter(([key]) => !key.startsWith('vnp_'))) }, { replace: true })
}

onMounted(async () => {
  await forwardGatewayResult()
  await load()
})

// The token allows viewing and cancelling unpaid orders; no email when customers cancel themselves.
const cancelling = ref(false)
const cancelError = ref<string | null>(null)
async function cancel() {
  const token = lookupToken()
  if (!token) return
  cancelling.value = true
  cancelError.value = null
  try {
    order.value = PublicOrder.parse(
      await $fetch(`/api/orders/${encodeURIComponent(code.value)}/cancel`, { method: 'POST', query: { token } }),
    )
  } catch (err) {
    cancelError.value = apiErrorMessage(err)
    // The order may have just been paid: reload so the customer sees the new status.
    await load()
  } finally {
    cancelling.value = false
  }
}

// The gateway sent the customer back but the order still awaits money: payment (or deposit), or the remainder after
// arrival.
const awaitingPayment = computed(
  () =>
    isResult.value &&
    (order.value?.status === 'pending_payment' ||
      (order.value?.status === 'processing' &&
        order.value.paymentStatus === 'deposit_paid' &&
        order.value.preorder?.arrivedAt != null)),
)

// Pay a pre-order's remainder with the token that opened the order; remember it so the result page can reopen it.
const payingRemainder = ref(false)
async function payRemainder() {
  const token = lookupToken()
  if (!token) return
  payingRemainder.value = true
  cancelError.value = null
  try {
    const result = PayRemainderResult.parse(
      await $fetch(`/api/orders/${encodeURIComponent(code.value)}/pay-remainder`, { method: 'POST', query: { token } }),
    )
    rememberOrderToken(Number(code.value), token)
    window.location.assign(result.checkoutUrl)
  } catch (err) {
    cancelError.value = apiErrorMessage(err)
    payingRemainder.value = false
    await load()
  }
}

// Email links carry the token in the URL: do not leak it to other sites via Referer.
useHead({ meta: [{ name: 'referrer', content: 'no-referrer' }] })
useSeo({ title: () => `Đơn hàng #${code.value}`, description: 'Thông tin đơn hàng của bạn.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
    <h1>Đơn hàng #{{ code }}</h1>
    <p v-if="missingToken" class="notice-error mt-8" role="alert" data-testid="order-token-missing">
      Trình duyệt này không còn thông tin để mở đơn hàng. Nếu bạn đã thanh toán, hãy mở đơn bằng link trong email xác
      nhận chúng tôi gửi bạn.
    </p>
    <p v-else-if="error" class="notice-error mt-8" role="alert">{{ error }}</p>
    <p v-else-if="!order" class="mt-8 text-muted-foreground">Đang tải…</p>
    <template v-else>
      <div
        v-if="awaitingPayment"
        class="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm"
        role="status"
        data-testid="payment-pending"
      >
        <span>Chưa nhận được thanh toán. Nếu bạn vừa chuyển khoản, đợi một lát rồi kiểm tra lại.</span>
        <button type="button" class="btn-outline" :disabled="checking" @click="load">Kiểm tra lại</button>
      </div>
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
        v-if="supportClient"
        :client="supportClient"
        :can-cancel="canRequestCancel(order)"
        :return-lines="
          order.status === 'completed' && order.fulfillmentStatus === 'delivered' ? order.lines : undefined
        "
        class="mt-8"
      />
    </template>
  </main>
</template>
