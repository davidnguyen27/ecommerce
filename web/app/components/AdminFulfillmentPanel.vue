<script setup lang="ts">
import type { AdminOrder, FieldError } from '@ecommerce/shared'

/**
 * Xử lý giao hàng ở trang chi tiết đơn: chuẩn bị, bàn giao vận chuyển kèm đơn vị vận chuyển và mã vận đơn, rồi
 * đánh dấu đã giao hoặc giao thất bại.
 * Thành công thì emit `update` với `AdminOrder` mà API trả; lỗi thì emit `reload` để trang nạp lại trạng thái mới.
 */
const props = defineProps<{ order: AdminOrder; canFulfill: boolean }>()
const emit = defineEmits<{ update: [order: unknown]; reload: [] }>()

const session = useAdminSession()
const busy = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref<FieldError[]>([])
const form = reactive({ carrier: '', trackingNumber: '' })
const errorAt = (path: string) => fieldErrors.value.find((f) => f.path === path)?.message

const paid = computed(() => props.order.status === 'processing' && props.order.paymentStatus === 'paid')

async function run(path: string, body?: Record<string, unknown>) {
  busy.value = true
  error.value = null
  fieldErrors.value = []
  try {
    emit('update', await session.adminFetch(`/api/admin/orders/${props.order.code}/${path}`, { method: 'POST', body }))
  } catch (err) {
    error.value = apiErrorMessage(err)
    fieldErrors.value = apiFieldErrors(err)
    // Lỗi trạng thái (ví dụ người khác vừa xử lý đơn): nạp lại để thấy trạng thái mới; lỗi trường thì giữ form.
    if (!fieldErrors.value.length) emit('reload')
  } finally {
    busy.value = false
  }
}

const prepare = () => run('prepare')
const handOver = () => run('hand-over', { ...form })
const deliver = () => {
  if (confirm(`Đánh dấu đơn #${props.order.code} đã giao tới khách? Đơn sẽ hoàn tất.`)) void run('deliver')
}
const failDelivery = () => {
  if (confirm(`Đánh dấu đơn #${props.order.code} giao thất bại? Khách sẽ nhận email báo shop sẽ liên hệ.`)) {
    void run('delivery-failed')
  }
}
</script>

<template>
  <div v-if="paid || order.shipment" class="admin-panel" data-testid="admin-order-fulfillment">
    <h2 class="admin-section-title">Giao hàng</h2>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert" style="font-size: 12px">
      <span>{{ error }}</span>
    </div>

    <dl
      v-if="order.shipment"
      style="margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 13px"
      data-testid="admin-order-shipment"
    >
      <dt style="color: var(--adm-muted)">Đơn vị vận chuyển</dt>
      <dd style="margin: 0">{{ order.shipment.carrier }}</dd>
      <dt style="color: var(--adm-muted)">Mã vận đơn</dt>
      <dd style="margin: 0; font-family: var(--adm-mono)">{{ order.shipment.trackingNumber }}</dd>
      <dt style="color: var(--adm-muted)">Bàn giao lúc</dt>
      <dd style="margin: 0">{{ formatDateTime(order.shipment.handedOverAt) }}</dd>
    </dl>

    <div
      v-if="order.shipment && order.fulfillmentStatus === 'handed_over' && canFulfill"
      style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px"
    >
      <button
        type="button"
        class="btn btn-primary btn-sm"
        data-testid="admin-order-deliver"
        :disabled="busy"
        @click="deliver"
      >
        Đã giao
      </button>
      <button
        type="button"
        class="btn btn-secondary btn-sm"
        data-testid="admin-order-delivery-failed"
        :disabled="busy"
        @click="failDelivery"
      >
        Giao thất bại
      </button>
    </div>
    <p
      v-else-if="order.fulfillmentStatus === 'failed'"
      style="margin: 12px 0 0; font-size: 13px; color: var(--adm-muted)"
    >
      Giao thất bại, khách đã nhận email báo shop sẽ liên hệ. Nhập lại kho và hoàn tiền chưa có (M6).
    </p>

    <template v-else-if="order.fulfillmentStatus === 'not_prepared'">
      <p style="margin: 0 0 12px; font-size: 13px; color: var(--adm-muted)">
        Đơn đã trả đủ, chờ soạn hàng. In phiếu soạn hàng rồi bắt đầu chuẩn bị.
      </p>
      <button
        v-if="canFulfill"
        type="button"
        class="btn btn-primary btn-sm"
        data-testid="admin-order-prepare"
        :disabled="busy"
        @click="prepare"
      >
        Bắt đầu chuẩn bị
      </button>
    </template>

    <template v-else-if="order.fulfillmentStatus === 'preparing'">
      <form v-if="canFulfill" data-testid="admin-order-handover" @submit.prevent="handOver">
        <div class="form-group">
          <label class="form-label" for="handover-carrier">Đơn vị vận chuyển</label>
          <input id="handover-carrier" v-model="form.carrier" class="form-input" maxlength="100" required />
          <small class="field-error-msg">{{ errorAt('carrier') }}</small>
        </div>
        <div class="form-group">
          <label class="form-label" for="handover-tracking">Mã vận đơn</label>
          <input id="handover-tracking" v-model="form.trackingNumber" class="form-input" maxlength="100" required />
          <small class="field-error-msg">{{ errorAt('trackingNumber') }}</small>
        </div>
        <div class="form-help" style="margin-bottom: 12px">
          Bàn giao trừ tồn và số đang giữ của đơn, ghi sổ xuất bán. Không hoàn tác được.
        </div>
        <button type="submit" class="btn btn-primary btn-sm" :disabled="busy">Ghi bàn giao vận chuyển</button>
      </form>
      <p v-else style="margin: 0; font-size: 13px; color: var(--adm-muted)">Kho đang chuẩn bị hàng.</p>
    </template>
  </div>
</template>
