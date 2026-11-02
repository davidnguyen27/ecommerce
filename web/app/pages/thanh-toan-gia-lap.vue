<script setup lang="ts">
// Trang của cổng thanh toán giả lập (API chạy không có khóa PayOS): link thanh toán mang mã đơn, số tiền, hạn và
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

useSeo({ title: 'Cổng thanh toán giả lập', description: 'Cổng thanh toán giả lập khi chạy local.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-md px-4 py-12 sm:py-20">
    <h1>Cổng thanh toán giả lập</h1>
    <p class="mt-2 text-sm text-muted-foreground">
      Website đang chạy không có khóa PayOS. Trang này thay cho trang thanh toán thật, không có tiền nào được chuyển.
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

    <!-- Ticket 05 và 06 nối hai nút này vào ghi nhận thanh toán và hết hạn. -->
    <div class="mt-6 grid gap-3">
      <button type="button" class="btn-primary w-full" disabled data-testid="simulate-paid">
        Giả lập đã thanh toán
      </button>
      <button type="button" class="btn-outline w-full" disabled data-testid="simulate-expired">Giả lập hết hạn</button>
    </div>

    <p v-if="returnPath" class="mt-6 text-center text-sm">
      <NuxtLink :to="returnPath" class="link">Quay lại đơn hàng</NuxtLink>
    </p>
  </main>
</template>
