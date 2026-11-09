<script setup lang="ts">
// Trang của cổng thanh toán giả lập (API chạy không có khóa ZaloPay): link thanh toán mang mã đơn, số tiền, hạn và
// trang quay về trong query. Không có tiền thật nào đi qua đây.
const route = useRoute()
const param = (name: string) => (typeof route.query[name] === 'string' ? route.query[name] : '')

const orderCode = computed(() => param('orderCode'))
const amount = computed(() => Number(param('amount')))
const expiresAt = computed(() => (Number.isNaN(Date.parse(param('expiresAt'))) ? null : param('expiresAt')))

// Chỉ quay về trang trên chính website, để link giả lập không thành chỗ chuyển hướng sang trang lạ.
const returnPath = computed(() => {
  const raw = param('returnUrl')
  if (!raw || !import.meta.client) return null
  try {
    const url = new URL(raw, window.location.origin)
    return url.origin === window.location.origin ? url.pathname + url.search : null
  } catch {
    return null
  }
})

// Số tiền "chuyển": mặc định đúng tổng đơn; sửa để thử trường hợp lệch tiền (đơn vào danh sách cần đối soát).
const paidAmount = ref<number | null>(null)
watchEffect(() => {
  if (paidAmount.value === null && Number.isFinite(amount.value) && amount.value > 0) paidAmount.value = amount.value
})
const busy = ref(false)
const error = ref<string | null>(null)
const done = ref(false)
const expired = ref(false)

async function simulatePaid() {
  busy.value = true
  error.value = null
  try {
    // API chỉ có khi server dùng cổng giả lập; ghi nhận qua cùng hàm với webhook, nguồn `simulator`.
    await $fetch('/api/payments/simulator/paid', {
      method: 'POST',
      body: { orderCode: Number(orderCode.value), amount: paidAmount.value },
    })
    done.value = true
    if (returnPath.value) await navigateTo(returnPath.value)
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}

async function simulateExpired() {
  busy.value = true
  error.value = null
  try {
    // Cùng hàm với job hết hạn, chỉ không chờ hết 15 phút.
    await $fetch('/api/payments/simulator/expired', { method: 'POST', body: { orderCode: Number(orderCode.value) } })
    expired.value = true
    if (returnPath.value) await navigateTo(returnPath.value)
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}

useSeo({ title: 'Cổng thanh toán giả lập', description: 'Cổng thanh toán giả lập khi chạy local.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-md px-4 py-12 sm:py-20">
    <h1>Cổng thanh toán giả lập</h1>
    <p class="mt-2 text-sm text-muted-foreground">
      Website đang chạy không có khóa ZaloPay. Trang này thay cho trang thanh toán thật, không có tiền nào được chuyển.
    </p>

    <dl class="mt-8 space-y-3 rounded-lg border border-border bg-card p-6 text-sm">
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Mã đơn</dt>
        <dd class="font-semibold" data-testid="simulator-order-code">#{{ orderCode }}</dd>
      </div>
      <div class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Số tiền</dt>
        <dd class="font-semibold tabular-nums" data-testid="simulator-amount">
          {{ Number.isFinite(amount) ? formatVnd(amount) : '—' }}
        </dd>
      </div>
      <div v-if="expiresAt" class="flex justify-between gap-4">
        <dt class="text-muted-foreground">Hết hạn lúc</dt>
        <dd>{{ formatDateTime(expiresAt, { seconds: true }) }}</dd>
      </div>
    </dl>

    <form class="mt-6 grid gap-3" @submit.prevent="simulatePaid">
      <label class="field">
        Số tiền chuyển (VND)
        <input
          v-model.number="paidAmount"
          class="field-input"
          type="number"
          min="1"
          step="1"
          required
          data-testid="simulate-amount"
        />
      </label>
      <p v-if="error" class="notice-error" role="alert">{{ error }}</p>
      <p v-if="done && !returnPath" class="notice-ok" role="status">Đã ghi nhận khoản thanh toán giả lập.</p>
      <p v-if="expired && !returnPath" class="notice-ok" role="status">Đơn đã hết hạn và được hủy.</p>
      <button type="submit" class="btn-primary w-full" :disabled="busy || !orderCode" data-testid="simulate-paid">
        Giả lập đã thanh toán
      </button>
      <button
        type="button"
        class="btn-outline w-full"
        :disabled="busy || !orderCode"
        data-testid="simulate-expired"
        @click="simulateExpired"
      >
        Giả lập hết hạn
      </button>
    </form>

    <p v-if="returnPath" class="mt-6 text-center text-sm">
      <NuxtLink :to="returnPath" class="link">Quay lại đơn hàng</NuxtLink>
    </p>
  </main>
</template>
