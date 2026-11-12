<script setup lang="ts">
import { PublicOrder } from '@ecommerce/shared'

// Đơn là dữ liệu cá nhân, mở bằng token: chỉ nạp ở trình duyệt, HTML từ server không có gì của đơn.
// Hai cách vào: link trong email (`?token=…`), hoặc trang kết quả khi cổng thanh toán đưa khách quay về
// (`?ket-qua=1`, không có token trong URL; token lấy từ sessionStorage của tab đặt mua).
const route = useRoute()
const code = computed(() => String(route.params.code))
const isResult = computed(() => route.query['ket-qua'] === '1')
const order = ref<PublicOrder | null>(null)
const error = ref<string | null>(null)
const missingToken = ref(false)
const checking = ref(false)

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
    // Trang kết quả hỏi cổng thanh toán trước khi trả đơn, phòng khi thông báo của cổng tới chậm.
    const query = isResult.value ? { token, refresh: '1' } : { token }
    order.value = PublicOrder.parse(await $fetch(`/api/orders/${encodeURIComponent(code.value)}`, { query }))
    error.value = null
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    checking.value = false
  }
}
// VNPAY đưa khách về kèm kết quả có chữ ký (`vnp_*`) trên URL: chuyển cho API kiểm chữ ký và ghi nhận (ADR 0010),
// không cần token đơn; rồi bỏ khỏi URL để tải lại hay chia sẻ link không mang theo. Lỗi thì `refresh=1` vẫn thử.
async function forwardGatewayResult() {
  const entries = Object.entries(route.query)
  const signed = Object.fromEntries(
    entries.filter(([key, value]) => key.startsWith('vnp_') && typeof value === 'string'),
  )
  if (!isResult.value || !('vnp_SecureHash' in signed)) return
  try {
    await $fetch('/api/payments/vnpay/return', { method: 'POST', body: signed })
  } catch {
    // Đã có IPN, truy vấn cổng và job hết hạn làm đường dự phòng.
  }
  await navigateTo({ query: Object.fromEntries(entries.filter(([key]) => !key.startsWith('vnp_'))) }, { replace: true })
}

onMounted(async () => {
  await forwardGatewayResult()
  await load()
})

// Token cho xem và hủy đơn chưa thanh toán; không gửi email khi khách tự hủy.
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
    // Đơn có thể vừa được thanh toán: nạp lại để khách thấy trạng thái mới.
    await load()
  } finally {
    cancelling.value = false
  }
}

const awaitingPayment = computed(() => isResult.value && order.value?.status === 'pending_payment')

// Link email có token trong URL: không gửi URL này cho trang khác qua Referer.
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
      <OrderView :order="order" class="mt-8" cancellable :cancelling="cancelling" @cancel="cancel" />
    </template>
  </main>
</template>
