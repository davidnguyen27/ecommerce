<script setup lang="ts">
import { AdminOrder } from '@ecommerce/shared'

/**
 * Khối đối soát ở trang chi tiết đơn: các khoản tiền bị gắn cờ cần đối soát, và hai thao tác (cần `payment.reconcile`):
 * khôi phục đơn đã hủy khi tiền về đủ, hoặc đóng mục vì đã xử lý ngoài hệ thống. Thao tác xong emit đơn mới do API trả.
 */
const props = defineProps<{ order: AdminOrder }>()
const emit = defineEmits<{ update: [order: AdminOrder] }>()

const session = useAdminSession()
const canReconcile = computed(() => session.can('payment.reconcile'))
const busy = ref(false)
const error = ref<string | null>(null)
const notes = reactive<Record<string, string>>({})

const flagged = computed(() =>
  props.order.payments.flatMap((p) => (p.reconciliation ? [{ payment: p, item: p.reconciliation }] : [])),
)
const received = computed(() => props.order.payments.reduce((sum, p) => sum + p.amount, 0))

async function act(itemId: string, action: 'restore' | 'resolve', body?: { note: string }) {
  busy.value = true
  error.value = null
  try {
    const result = await session.adminFetch(`/api/admin/reconciliation/${itemId}/${action}`, { method: 'POST', body })
    emit('update', AdminOrder.parse(result))
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}

function restore(itemId: string) {
  if (!confirm(`Khôi phục đơn #${props.order.code}? Hàng sẽ được giữ lại và khách nhận email đã nhận thanh toán.`))
    return
  return act(itemId, 'restore')
}

function resolve(itemId: string) {
  return act(itemId, 'resolve', { note: notes[itemId] ?? '' })
}
</script>

<template>
  <div v-if="flagged.length" id="doi-soat" class="admin-panel" data-testid="admin-reconciliation">
    <h2 class="admin-section-title">Đối soát</h2>
    <p style="margin: 0 0 12px; font-size: 13px">
      Đã nhận <strong>{{ formatVnd(received) }}</strong> · tổng phải trả <strong>{{ formatVnd(order.total) }}</strong>
      <span v-if="received !== order.total" style="color: var(--adm-danger)">
        (lệch {{ formatVnd(received - order.total) }})
      </span>
    </p>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div
      v-for="{ payment, item } in flagged"
      :key="item.id"
      data-testid="admin-reconciliation-item"
      style="border-top: 1px solid var(--adm-border); padding: 12px 0; font-size: 13px"
    >
      <div style="display: flex; justify-content: space-between; gap: 12px">
        <div>
          <div style="font-weight: 600">{{ RECONCILIATION_REASON_LABELS[item.reason] }}</div>
          <div style="color: var(--adm-muted); font-size: 12px">
            {{ formatVnd(payment.amount) }} · {{ formatDateTime(payment.paidAt) }} · {{ payment.reference }}
          </div>
        </div>
        <div style="white-space: nowrap; font-size: 12px">
          {{ item.resolution ? RECONCILIATION_RESOLUTION_LABELS[item.resolution] : 'Chưa xử lý' }}
        </div>
      </div>

      <div v-if="item.status === 'resolved'" style="margin-top: 6px; font-size: 12px; color: var(--adm-muted)">
        <span v-if="item.resolvedBy">{{ item.resolvedBy.name }}</span>
        <span v-if="item.resolvedAt"> · {{ formatDateTime(item.resolvedAt) }}</span>
        <div v-if="item.note" style="color: var(--adm-ink); margin-top: 2px">Ghi chú: {{ item.note }}</div>
      </div>

      <div v-else-if="canReconcile" style="margin-top: 10px">
        <button
          v-if="order.status === 'cancelled'"
          type="button"
          class="btn btn-primary btn-sm"
          data-testid="reconciliation-restore"
          :disabled="busy"
          style="margin-bottom: 10px"
          @click="restore(item.id)"
        >
          Khôi phục đơn
        </button>
        <form @submit.prevent="resolve(item.id)">
          <div class="form-group" style="margin-bottom: 8px">
            <label class="form-label" :for="`reconcile-note-${item.id}`" style="font-size: 12px">
              Ghi chú xử lý ngoài hệ thống (số tiền, mã giao dịch ngân hàng)
            </label>
            <textarea
              :id="`reconcile-note-${item.id}`"
              v-model="notes[item.id]"
              class="form-textarea"
              rows="2"
              maxlength="2000"
              required
            />
          </div>
          <button
            type="submit"
            class="btn btn-secondary btn-sm"
            data-testid="reconciliation-resolve"
            :disabled="busy || !notes[item.id]?.trim()"
          >
            Đã xử lý ngoài hệ thống
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
