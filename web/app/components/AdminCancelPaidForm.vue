<script setup lang="ts">
import { AdminOrder, OrderCancelCause } from '@ecommerce/shared'

/**
 * Hủy đơn đã nhận tiền (cần `order.cancel_paid`, spec M6a): chọn lý do, đề xuất số tiền hoàn (mặc định toàn bộ số còn
 * hoàn được). Hoàn ít hơn thì ghi chú bắt buộc; không nhập được hàng thì khóa ở mức hoàn đủ. Kế toán thực hiện hoàn ở
 * khối Hoàn tiền. Xong emit đơn mới do API trả.
 */
const props = defineProps<{ order: AdminOrder }>()
const emit = defineEmits<{ update: [order: AdminOrder]; close: [] }>()

const session = useAdminSession()
const busy = ref(false)
const error = ref<string | null>(null)
const form = reactive({ cause: 'changed_mind' as OrderCancelCause, refundAmount: props.order.refundable, note: '' })

const fullRefund = computed(() => form.cause === 'supply_failed')
watch(fullRefund, (full) => {
  if (full) form.refundAmount = props.order.refundable
})
const reduced = computed(() => form.refundAmount < props.order.refundable)
const valid = computed(
  () =>
    Number.isInteger(form.refundAmount) &&
    form.refundAmount >= 0 &&
    form.refundAmount <= props.order.refundable &&
    (!reduced.value || form.note.trim().length > 0),
)

async function submit() {
  const refundText = form.refundAmount > 0 ? `hoàn ${formatVnd(form.refundAmount)}` : 'không hoàn tiền'
  if (!confirm(`Hủy đơn #${props.order.code} và ${refundText}? Hàng đang giữ được nhả, khách nhận email.`)) return
  busy.value = true
  error.value = null
  try {
    const result = await session.adminFetch(`/api/admin/orders/${props.order.code}/cancel-paid`, {
      method: 'POST',
      body: { cause: form.cause, refundAmount: form.refundAmount, note: form.note.trim() || undefined },
    })
    emit('update', AdminOrder.parse(result))
    emit('close')
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="admin-panel" data-testid="admin-cancel-paid" @submit.prevent="submit">
    <h2 class="admin-section-title">Hủy đơn đã nhận tiền</h2>
    <p style="margin: 0 0 12px; font-size: 13px">
      Đã nhận <strong>{{ formatVnd(order.received) }}</strong> · còn hoàn được
      <strong>{{ formatVnd(order.refundable) }}</strong>
    </p>
    <p
      v-if="order.preorder"
      style="margin: 0 0 12px; font-size: 12px; color: var(--adm-muted)"
      data-testid="cancel-paid-preorder"
    >
      Đơn đặt trước: tiền cọc {{ formatVnd(order.preorder.depositAmount) }}. Số tiền hoàn theo chính sách đặt trước đã
      áp dụng cho đơn (mất cọc ghi rõ ở ghi chú). Hàng đã giữ cho đơn chuyển cho đơn chờ kế tiếp theo thứ tự cọc.
    </p>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div class="form-group">
      <label class="form-label" for="cancel-paid-cause">Lý do</label>
      <select id="cancel-paid-cause" v-model="form.cause" class="form-select" data-testid="cancel-paid-cause">
        <option v-for="(label, value) in CANCEL_CAUSE_LABELS" :key="value" :value="value">{{ label }}</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label" for="cancel-paid-amount">Số tiền hoàn (VND)</label>
      <input
        id="cancel-paid-amount"
        v-model.number="form.refundAmount"
        type="number"
        min="0"
        :max="order.refundable"
        step="1"
        class="form-input"
        :disabled="fullRefund"
        data-testid="cancel-paid-amount"
        required
      />
      <p v-if="fullRefund" style="margin: 4px 0 0; font-size: 12px; color: var(--adm-muted)">
        Không nhập được hàng thì hoàn đủ.
      </p>
    </div>
    <div class="form-group">
      <label class="form-label" for="cancel-paid-note">
        Ghi chú nội bộ{{ reduced ? ' (bắt buộc khi hoàn ít hơn số còn hoàn được)' : '' }}
      </label>
      <textarea
        id="cancel-paid-note"
        v-model="form.note"
        class="form-textarea"
        rows="2"
        maxlength="2000"
        :required="reduced"
        data-testid="cancel-paid-note"
      />
    </div>
    <div style="display: flex; gap: 8px">
      <button type="submit" class="btn btn-danger btn-sm" data-testid="cancel-paid-submit" :disabled="busy || !valid">
        Hủy đơn
      </button>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="emit('close')">Thôi</button>
    </div>
  </form>
</template>
