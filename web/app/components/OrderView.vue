<script setup lang="ts">
import { ORDER_CANCEL_CAUSE_CUSTOMER_TEXT, type PublicOrder } from '@ecommerce/shared'

/**
 * An order as customers see it: order, payment and fulfillment status apart, time left on the reservation, carrier
 * and tracking once handed over, lines, money and address. Shared by the token order page and the account order page;
 * action buttons go in the `actions` slot.
 */
const props = defineProps<{
  order: PublicOrder
  /** The caller has a cancel path (token or account): shows the cancel button while the order awaits payment. */
  cancellable?: boolean
  cancelling?: boolean
  /** Creating the remaining-balance link (the caller calls the API on `payRemainder`). */
  payingRemainder?: boolean
}>()
const emit = defineEmits<{ cancel: []; payRemainder: [] }>()

const deliveryText = (from: string, to: string) => `${formatDateOnly(from)} – ${formatDateOnly(to)}`
// Staff changed the campaign's delivery after the order (ticket 09): show the new dates and the original promise.
const deliveryChanged = computed(() => {
  const p = props.order.preorder
  return p !== null && (p.currentDeliveryFrom !== p.deliveryFrom || p.currentDeliveryTo !== p.deliveryTo)
})

// A cancelled order keeps "deposited" as payment status (ADR 0014) but nothing is left to pay.
const awaitingRemainder = computed(
  () =>
    props.order.status === 'processing' &&
    props.order.paymentStatus === 'deposit_paid' &&
    props.order.preorder?.remainderDueAt != null,
)

// A pending-deposit pre-order holds allocation, not stock (ADR 0013).
const isPreorder = computed(() => props.order.preorder !== null)
const heldThing = computed(() => (isPreorder.value ? 'Suất đặt trước' : 'Hàng'))

function requestCancel() {
  if (confirm(`Hủy đơn hàng #${props.order.code}? ${heldThing.value} đang giữ cho bạn sẽ được nhả cho khách khác.`))
    emit('cancel')
}

// The cart was emptied at checkout: when the order expires, put its lines back so the customer can reorder.
// Prices are the order-time prices; the cart page reports any price or stock change.
const cart = useCart()
async function backToCart() {
  for (const line of props.order.lines) {
    for (let i = 0; i < line.quantity; i++) cart.add({ variantId: line.variantId, price: line.price })
  }
  await navigateTo('/gio-hang')
}

// The countdown runs only in the browser; the order page does not SSR order data, so hydration never mismatches.
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
        {{ heldThing }} được giữ cho bạn thêm
        <strong class="tabular-nums" data-testid="reservation-remaining">{{ remainingText }}</strong
        >. {{ isPreorder ? 'Trả cọc' : 'Thanh toán' }} trước khi hết giờ để giữ đơn.
      </template>
      <template v-else>Đã hết thời gian giữ {{ isPreorder ? 'suất' : 'hàng' }}.</template>
    </div>

    <!-- Pre-orders are not in the cart (ADR 0012): after expiry the customer reorders from the product page. -->
    <p
      v-if="order.status === 'cancelled' && order.cancelReason === 'expired' && isPreorder"
      class="rounded-md border border-border bg-card px-4 py-3 text-sm"
      role="status"
      data-testid="order-expired"
    >
      Đơn đặt trước đã hết hạn vì chưa trả cọc trong thời gian giữ suất. Bạn có thể đặt trước lại ở trang sản phẩm nếu
      còn suất.
    </p>
    <div
      v-else-if="order.status === 'cancelled' && order.cancelReason === 'expired'"
      class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm"
      role="status"
      data-testid="order-expired"
    >
      <span>Đơn đã hết hạn vì chưa thanh toán trong thời gian giữ hàng. Bạn có thể đặt mua lại từ giỏ hàng.</span>
      <button type="button" class="btn-outline" data-testid="order-back-to-cart" @click="backToCart">
        Quay lại giỏ hàng
      </button>
    </div>
    <!-- A paid order cancelled by the shop (M6a): cause and refund; refunds are tracked separately (ADR 0014). -->
    <div
      v-else-if="order.status === 'cancelled' && order.cancelCause"
      class="space-y-2 rounded-md border border-border bg-card px-4 py-3 text-sm"
      role="status"
      data-testid="order-cancelled"
    >
      <p>
        Đơn đã được cửa hàng hủy{{ order.cancelledAt ? ` lúc ${formatDateTime(order.cancelledAt)}` : '' }} vì
        {{ ORDER_CANCEL_CAUSE_CUSTOMER_TEXT[order.cancelCause] }}.
      </p>
      <p v-if="order.refunds.length === 0">Đơn này không được hoàn tiền theo chính sách đã áp dụng cho đơn.</p>
    </div>
    <p
      v-else-if="order.status === 'cancelled'"
      class="rounded-md border border-border bg-card px-4 py-3 text-sm"
      role="status"
      data-testid="order-cancelled"
    >
      Đơn đã được hủy{{ order.cancelledAt ? ` lúc ${formatDateTime(order.cancelledAt)}` : '' }}. {{ heldThing }} giữ cho
      đơn đã được nhả.
    </p>

    <section
      v-if="order.refunds.length"
      class="rounded-lg border border-border bg-card p-5 text-sm"
      data-testid="order-refunds"
    >
      <h2 class="font-semibold">Hoàn tiền</h2>
      <p class="mt-1 text-muted-foreground">
        Đã thanh toán {{ formatVnd(order.received) }}. Tùy ngân hàng, tiền hoàn có thể cần vài ngày làm việc để về tài
        khoản.
      </p>
      <ul class="mt-3 divide-y divide-border">
        <li
          v-for="(refund, index) in order.refunds"
          :key="index"
          class="flex flex-wrap items-center justify-between gap-2 py-2"
          data-testid="order-refund"
        >
          <span class="font-semibold tabular-nums">{{ formatVnd(refund.amount) }}</span>
          <span v-if="refund.status === 'refunded'">
            Đã hoàn{{ refund.completedAt ? ` ngày ${formatDate(refund.completedAt)}` : '' }}
          </span>
          <span v-else class="text-muted-foreground">Đang hoàn</span>
        </li>
      </ul>
    </section>

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
    <p
      v-else-if="order.fulfillmentStatus === 'returned' && order.status === 'processing'"
      class="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      role="status"
      data-testid="delivery-returned"
    >
      Hàng chưa giao được đã được trả về shop. Shop sẽ liên hệ với bạn để giao lại hoặc xử lý đơn.
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

    <!-- A deposited pre-order with stock fully arrived: pay the remainder so the shop can prepare and ship. -->
    <div
      v-if="awaitingRemainder && order.preorder"
      :class="[
        'flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm',
        order.preorder.remainderOverdueAt
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-emerald-200 bg-emerald-50 text-emerald-900',
      ]"
      role="status"
      data-testid="order-remainder"
    >
      <span v-if="order.preorder.remainderOverdueAt" data-testid="order-remainder-overdue">
        Đã quá hạn trả phần còn lại ({{ formatDate(order.preorder.remainderDueAt!) }}). Hàng vẫn được giữ và bạn vẫn có
        thể trả <strong class="tabular-nums">{{ formatVnd(order.preorder.remainingAmount) }}</strong
        >; shop sẽ liên hệ với bạn.
      </span>
      <span v-else>
        Hàng đã về. Vui lòng trả phần còn lại
        <strong class="tabular-nums">{{ formatVnd(order.preorder.remainingAmount) }}</strong>
        trước <strong>{{ formatDate(order.preorder.remainderDueAt!) }}</strong
        >.
      </span>
      <button
        type="button"
        class="btn-primary"
        :disabled="payingRemainder"
        data-testid="order-pay-remainder"
        @click="emit('payRemainder')"
      >
        {{ payingRemainder ? 'Đang tạo thanh toán…' : 'Trả phần còn lại' }}
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
        <div v-if="order.voucherCode" class="flex justify-between gap-4" data-testid="order-discount">
          <dt class="text-muted-foreground">
            Mã giảm giá <span class="font-mono">{{ order.voucherCode }}</span>
          </dt>
          <dd class="tabular-nums">−{{ formatVnd(order.discount) }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted-foreground">Phí giao</dt>
          <dd class="tabular-nums">{{ order.shippingFee === 0 ? 'Miễn phí' : formatVnd(order.shippingFee) }}</dd>
        </div>
        <div class="flex justify-between gap-4 text-base">
          <dt class="font-semibold">Tổng phải trả</dt>
          <dd class="font-semibold tabular-nums" data-testid="order-total">{{ formatVnd(order.total) }}</dd>
        </div>
        <template v-if="order.preorder">
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Tiền cọc ({{ order.preorder.depositPercent }}%)</dt>
            <dd class="tabular-nums" data-testid="order-deposit">{{ formatVnd(order.preorder.depositAmount) }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted-foreground">Còn lại khi hàng về</dt>
            <dd class="tabular-nums" data-testid="order-remaining">
              {{ formatVnd(order.preorder.remainingAmount) }}
            </dd>
          </div>
        </template>
      </dl>
      <p v-if="order.preorder" class="mt-4 text-sm text-muted-foreground" data-testid="order-preorder">
        Đơn đặt trước. Giao dự kiến
        <span data-testid="order-delivery">{{
          deliveryText(order.preorder.currentDeliveryFrom, order.preorder.currentDeliveryTo)
        }}</span
        ><template v-if="deliveryChanged">
          (đã đổi; lúc đặt là {{ deliveryText(order.preorder.deliveryFrom, order.preorder.deliveryTo) }})</template
        >; khi hàng về, bạn có {{ order.preorder.remainderDays }} ngày để trả phần còn lại.
      </p>
      <p v-if="order.preorder?.arrivedAt" class="mt-3 text-sm" data-testid="order-arrived">
        Hàng đã về đủ lúc {{ formatDateTime(order.preorder.arrivedAt) }}.
      </p>
      <p
        v-else-if="order.preorder && order.preorder.arrivedQuantity > 0"
        class="mt-3 text-sm"
        data-testid="order-arriving"
      >
        Đã về {{ order.preorder.arrivedQuantity }}/{{ order.preorder.quantity }} cái, đang chờ phần còn lại.
      </p>
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
