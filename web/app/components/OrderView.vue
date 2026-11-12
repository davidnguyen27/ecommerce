<script setup lang="ts">
import type { PublicOrder } from '@ecommerce/shared'

/**
 * Một đơn như khách thấy: trạng thái đơn, thanh toán và giao hàng tách riêng, thời gian giữ hàng còn lại,
 * đơn vị vận chuyển và mã vận đơn khi đã bàn giao, dòng đơn, tiền và địa chỉ nhận.
 * Dùng chung cho trang đơn qua token và trang đơn trong tài khoản; nút thao tác đặt qua slot `actions`.
 */
const props = defineProps<{
  order: PublicOrder
  /** Nơi dùng có đường hủy đơn (token hay tài khoản): hiện nút hủy khi đơn còn chờ thanh toán. */
  cancellable?: boolean
  cancelling?: boolean
}>()
const emit = defineEmits<{ cancel: [] }>()

function requestCancel() {
  if (confirm(`Hủy đơn hàng #${props.order.code}? Hàng đang giữ cho bạn sẽ được nhả cho khách khác.`)) emit('cancel')
}

// Giỏ đã được làm trống lúc đặt mua: đơn hết hạn thì đưa các dòng đơn trở lại giỏ để khách đặt lại.
// Giá là giá lúc đặt; trang giỏ tự báo nếu giá hay tồn đã đổi.
const cart = useCart()
async function backToCart() {
  for (const line of props.order.lines) {
    for (let i = 0; i < line.quantity; i++) cart.add({ variantId: line.variantId, price: line.price })
  }
  await navigateTo('/gio-hang')
}

// Đồng hồ chỉ chạy ở trình duyệt; trang đơn không SSR dữ liệu đơn nên không lệch lúc hydrate.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1000)
})
onBeforeUnmount(() => clearInterval(timer))

const holding = computed(() => props.order.status === 'pending_payment' && props.order.reservedUntil !== null)
const remainingMs = computed(() =>
  props.order.reservedUntil ? Math.max(0, Date.parse(props.order.reservedUntil) - now.value) : 0,
)
const remainingText = computed(() => {
  const seconds = Math.ceil(remainingMs.value / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
</script>

<template>
  <div class="space-y-8">
    <dl class="grid gap-4 rounded-lg border border-border bg-card p-5 text-sm sm:grid-cols-3">
      <div>
        <dt class="text-muted-foreground">Đơn hàng</dt>
        <dd class="mt-1 font-semibold" data-testid="order-status">{{ ORDER_STATUS_LABELS[order.status] }}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Thanh toán</dt>
        <dd class="mt-1 font-semibold" data-testid="payment-status">
          {{ PAYMENT_STATUS_LABELS[order.paymentStatus] }}
        </dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Giao hàng</dt>
        <dd class="mt-1 font-semibold" data-testid="fulfillment-status">
          {{ FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus] }}
        </dd>
      </div>
    </dl>

    <div
      v-if="holding"
      class="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      role="status"
      data-testid="reservation"
    >
      <template v-if="remainingMs > 0">
        Hàng được giữ cho bạn thêm
        <strong class="tabular-nums" data-testid="reservation-remaining">{{ remainingText }}</strong
        >. Thanh toán trước khi hết giờ để giữ đơn.
      </template>
      <template v-else>Đã hết thời gian giữ hàng.</template>
    </div>

    <div
      v-if="order.status === 'cancelled' && order.cancelReason === 'expired'"
      class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm"
      role="status"
      data-testid="order-expired"
    >
      <span>Đơn đã hết hạn vì chưa thanh toán trong thời gian giữ hàng. Bạn có thể đặt mua lại từ giỏ hàng.</span>
      <button type="button" class="btn-outline" data-testid="order-back-to-cart" @click="backToCart">
        Quay lại giỏ hàng
      </button>
    </div>
    <p
      v-else-if="order.status === 'cancelled'"
      class="rounded-md border border-border bg-card px-4 py-3 text-sm"
      role="status"
      data-testid="order-cancelled"
    >
      Đơn đã được hủy{{ order.cancelledAt ? ` lúc ${formatDateTime(order.cancelledAt)}` : '' }}. Hàng giữ cho đơn đã
      được nhả.
    </p>

    <dl
      v-if="order.shipment"
      class="grid gap-4 rounded-lg border border-border bg-card p-5 text-sm sm:grid-cols-3"
      data-testid="order-shipment"
    >
      <div>
        <dt class="text-muted-foreground">Đơn vị vận chuyển</dt>
        <dd class="mt-1 font-semibold">{{ order.shipment.carrier }}</dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Mã vận đơn</dt>
        <dd class="mt-1 font-semibold tabular-nums" data-testid="order-tracking-number">
          {{ order.shipment.trackingNumber }}
        </dd>
      </div>
      <div>
        <dt class="text-muted-foreground">Bàn giao lúc</dt>
        <dd class="mt-1">{{ formatDateTime(order.shipment.handedOverAt) }}</dd>
      </div>
    </dl>
    <p
      v-if="order.fulfillmentStatus === 'failed'"
      class="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      role="status"
      data-testid="delivery-failed"
    >
      Đơn vị vận chuyển chưa giao được đơn này. Shop sẽ liên hệ với bạn để sắp xếp lại việc giao hàng.
    </p>

    <div v-if="cancellable && order.status === 'pending_payment'">
      <button
        type="button"
        class="btn-outline"
        :disabled="cancelling"
        data-testid="order-cancel"
        @click="requestCancel"
      >
        {{ cancelling ? 'Đang hủy…' : 'Hủy đơn' }}
      </button>
    </div>

    <slot name="actions" />

    <section aria-label="Các dòng trong đơn">
      <ul class="divide-y divide-border border-y border-border">
        <li v-for="line in order.lines" :key="line.variantId" class="flex gap-4 py-4" data-testid="order-line">
          <img
            v-if="line.image"
            :src="imageSrc(line.image, 160)"
            :alt="line.image.alt || line.productName"
            width="80"
            height="100"
            class="aspect-[4/5] w-16 flex-none rounded-md bg-secondary object-cover sm:w-20"
          />
          <div v-else class="aspect-[4/5] w-16 flex-none rounded-md bg-secondary sm:w-20" />
          <div class="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <div class="min-w-0">
              <p class="font-medium">{{ line.productName }}</p>
              <p class="mt-0.5 text-sm text-muted-foreground">
                {{ variantAttributesText(line.attributes) }} · SKU {{ line.sku }}
              </p>
              <p class="mt-0.5 text-sm text-muted-foreground">{{ line.quantity }} × {{ formatVnd(line.price) }}</p>
            </div>
            <p class="font-semibold tabular-nums">{{ formatVnd(line.lineTotal) }}</p>
          </div>
        </li>
      </ul>
      <dl class="mt-4 space-y-2 text-sm">
        <div class="flex justify-between gap-4">
          <dt class="text-muted-foreground">Tổng tiền hàng</dt>
          <dd class="tabular-nums">{{ formatVnd(order.subtotal) }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted-foreground">Phí giao</dt>
          <dd class="tabular-nums">{{ order.shippingFee === 0 ? 'Miễn phí' : formatVnd(order.shippingFee) }}</dd>
        </div>
        <div class="flex justify-between gap-4 text-base">
          <dt class="font-semibold">Tổng phải trả</dt>
          <dd class="font-semibold tabular-nums" data-testid="order-total">{{ formatVnd(order.total) }}</dd>
        </div>
      </dl>
    </section>

    <section class="grid gap-6 text-sm sm:grid-cols-2">
      <div>
        <h2 class="text-base">Giao tới</h2>
        <p class="mt-2">{{ order.address.recipientName }} · {{ order.address.phone }}</p>
        <p class="text-muted-foreground">
          {{ order.address.streetAddress }}, {{ order.address.wardName }}, {{ order.address.provinceName }}
        </p>
        <p class="text-muted-foreground">{{ order.address.email }}</p>
        <p v-if="order.note" class="mt-2">Ghi chú: {{ order.note }}</p>
      </div>
      <div v-if="order.invoice" data-testid="order-invoice">
        <h2 class="text-base">Xuất hóa đơn công ty</h2>
        <p class="mt-2">{{ order.invoice.companyName }}</p>
        <p class="text-muted-foreground">Mã số thuế {{ order.invoice.taxCode }}</p>
        <p class="text-muted-foreground">{{ order.invoice.address }}</p>
      </div>
      <div v-if="order.policies.length">
        <h2 class="text-base">Chính sách áp dụng</h2>
        <ul class="mt-2 space-y-1">
          <li v-for="policy in order.policies" :key="policy.slug">
            <NuxtLink :to="`/trang/${policy.slug}`" class="link">{{ policy.title }}</NuxtLink>
          </li>
        </ul>
      </div>
    </section>

    <p class="text-xs text-muted-foreground">Đặt lúc {{ formatDateTime(order.createdAt) }}</p>
  </div>
</template>
