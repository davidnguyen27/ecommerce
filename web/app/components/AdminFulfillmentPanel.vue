<script setup lang="ts">
import type { AdminOrder, FieldError } from '@ecommerce/shared'

/**
 * Xử lý giao hàng ở trang chi tiết đơn: chuẩn bị, bàn giao vận chuyển kèm đơn vị vận chuyển và mã vận đơn, rồi
 * đánh dấu đã giao hoặc giao thất bại. Giao thất bại thì giao lại, hoặc nhận hàng hoàn về rồi giao lại từ kho hay hủy
 * đơn (M6a).
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
const redeliver = () => run('redeliver', { ...form })

// Mặc định nhập lại tồn cả dòng; nhân viên chuyển phần hỏng/mất sang ô bên cạnh.
const returns = ref(props.order.lines.map((line) => ({ restocked: line.quantity, writtenOff: 0 })))
const returnsValid = computed(() =>
  props.order.lines.every((line, i) => {
    const r = returns.value[i]!
    return r.restocked >= 0 && r.writtenOff >= 0 && r.restocked + r.writtenOff === line.quantity
  }),
)
const returnToStock = () => {
  if (!confirm(`Ghi nhận hàng hoàn về cho đơn #${props.order.code}? Phần nhập lại sẽ vào tồn, không hoàn tác được.`))
    return
  void run('return-to-stock', {
    lines: props.order.lines.map((line, i) => ({ variantId: line.variantId, ...returns.value[i]! })),
  })
}
const restockRedeliver = () => {
  if (confirm(`Giao lại đơn #${props.order.code} từ kho? Hàng sẽ được giữ lại cho đơn.`)) void run('restock-redeliver')
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
    <template v-else-if="order.fulfillmentStatus === 'failed'">
      <p style="margin: 12px 0; font-size: 13px; color: var(--adm-muted)">
        Giao thất bại, khách đã nhận email báo shop sẽ liên hệ. Giao lại với mã vận đơn mới, hoặc ghi nhận hàng hoàn về
        kho rồi hủy đơn.
      </p>
      <template v-if="canFulfill">
        <form data-testid="admin-order-redeliver" style="margin-bottom: 16px" @submit.prevent="redeliver">
          <div class="form-group">
            <label class="form-label" for="redeliver-carrier">Đơn vị vận chuyển (giao lại)</label>
            <input id="redeliver-carrier" v-model="form.carrier" class="form-input" maxlength="100" required />
            <small class="field-error-msg">{{ errorAt('carrier') }}</small>
          </div>
          <div class="form-group">
            <label class="form-label" for="redeliver-tracking">Mã vận đơn mới</label>
            <input id="redeliver-tracking" v-model="form.trackingNumber" class="form-input" maxlength="100" required />
            <small class="field-error-msg">{{ errorAt('trackingNumber') }}</small>
          </div>
          <button type="submit" class="btn btn-primary btn-sm" :disabled="busy">Giao lại</button>
        </form>

        <form data-testid="admin-order-return-to-stock" @submit.prevent="returnToStock">
          <div class="form-label" style="margin-bottom: 6px">Nhận hàng hoàn về</div>
          <div
            v-for="(line, i) in order.lines"
            :key="line.variantId"
            style="display: grid; grid-template-columns: 1fr 90px 90px; gap: 8px; align-items: end; margin-bottom: 8px"
          >
            <div style="font-size: 12px">
              <div style="font-family: var(--adm-mono)">{{ line.sku }}</div>
              <div style="color: var(--adm-muted)">× {{ line.quantity }}</div>
            </div>
            <div>
              <label class="form-label" :for="`return-restock-${i}`" style="font-size: 11px">Nhập lại tồn</label>
              <input
                :id="`return-restock-${i}`"
                v-model.number="returns[i]!.restocked"
                type="number"
                min="0"
                :max="line.quantity"
                class="form-input"
                required
              />
            </div>
            <div>
              <label class="form-label" :for="`return-writeoff-${i}`" style="font-size: 11px">Hỏng/mất</label>
              <input
                :id="`return-writeoff-${i}`"
                v-model.number="returns[i]!.writtenOff"
                type="number"
                min="0"
                :max="line.quantity"
                class="form-input"
                required
              />
            </div>
            <small v-if="errorAt(`lines.${i}`)" class="field-error-msg" style="grid-column: 1 / -1">
              {{ errorAt(`lines.${i}`) }}
            </small>
          </div>
          <div class="form-help" style="margin-bottom: 12px">
            Phần nhập lại tồn ghi sổ "Hàng hoàn về"; phần hỏng/mất không vào tồn. Mỗi dòng: hai số cộng lại bằng số
            lượng.
          </div>
          <button type="submit" class="btn btn-secondary btn-sm" :disabled="busy || !returnsValid">
            Ghi nhận hàng hoàn về
          </button>
        </form>
      </template>
    </template>

    <template v-else-if="order.fulfillmentStatus === 'returned'">
      <p style="margin: 0 0 8px; font-size: 13px">Hàng đã hoàn về kho:</p>
      <ul style="margin: 0 0 12px; padding-left: 18px; font-size: 12px" data-testid="admin-order-returned-lines">
        <li v-for="line in order.lines" :key="line.variantId">
          <span style="font-family: var(--adm-mono)">{{ line.sku }}</span
          >: nhập lại {{ line.returnedQuantity }}, hỏng/mất
          {{ line.writtenOffQuantity }}
        </li>
      </ul>
      <p style="margin: 0 0 12px; font-size: 13px; color: var(--adm-muted)">
        Giao lại từ kho (giữ hàng lại cho đơn rồi chuẩn bị như mới), hoặc hủy đơn bằng nút "Hủy đơn".
      </p>
      <button
        v-if="canFulfill"
        type="button"
        class="btn btn-primary btn-sm"
        data-testid="admin-order-restock-redeliver"
        :disabled="busy"
        @click="restockRedeliver"
      >
        Giao lại từ kho
      </button>
    </template>

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
