<script setup lang="ts">
import { AdminOrder, type AdminRefund } from '@ecommerce/shared'

/**
 * Refunds block on the order detail page (ADR 0014): received, refunded, refunding, and each refund. `payment.refund`
 * holders record transfers for pending refunds, settle gateway-processing ones, recreate failed ones. Emits the new
 * order the API returns.
 */
defineProps<{ order: AdminOrder }>()
const emit = defineEmits<{ update: [order: AdminOrder] }>()

const session = useAdminSession()
const canRefund = computed(() => session.can('payment.refund'))
const busy = ref(false)
const error = ref<string | null>(null)

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })
type Draft = { bankReference: string; transferredOn: string; note: string; amount: number }
const drafts = reactive<Record<string, Draft>>({})
const draft = (refund: AdminRefund) =>
  (drafts[refund.id] ??= { bankReference: '', transferredOn: today(), note: '', amount: refund.amount })

async function act(refundId: string, action: 'manual' | 'vnpay' | 'settle' | 'retry', body?: Record<string, unknown>) {
  busy.value = true
  error.value = null
  try {
    const result = await session.adminFetch(`/api/admin/refunds/${refundId}/${action}`, { method: 'POST', body })
    emit('update', AdminOrder.parse(result))
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}

/**
 * Sends the refund command to the gateway (VNPAY; the simulator locally). The result shows at once in status and note.
 */
function viaGateway(refund: AdminRefund) {
  if (!confirm(`Gửi lệnh hoàn ${formatVnd(refund.amount)} qua VNPAY? Tiền sẽ trả về thẻ hay tài khoản khách đã dùng.`))
    return
  return act(refund.id, 'vnpay')
}

function recordManual(refund: AdminRefund) {
  const d = draft(refund)
  if (!confirm(`Ghi đã chuyển ${formatVnd(refund.amount)} cho khách? Khách sẽ nhận email đã hoàn tiền.`)) return
  return act(refund.id, 'manual', {
    bankReference: d.bankReference,
    transferredOn: d.transferredOn,
    note: d.note || undefined,
  })
}

function settle(refund: AdminRefund, outcome: 'succeeded' | 'failed') {
  const text = outcome === 'succeeded' ? 'đã hoàn (khách sẽ nhận email)' : 'thất bại'
  if (!confirm(`Chốt khoản ${formatVnd(refund.amount)} là ${text}?`)) return
  return act(refund.id, 'settle', { outcome, note: draft(refund).note })
}

function retry(refund: AdminRefund) {
  const d = draft(refund)
  return act(refund.id, 'retry', { amount: d.amount, note: d.note || undefined })
}
</script>

<template>
  <div v-if="order.refunds.length" id="hoan-tien" class="admin-panel" data-testid="admin-refunds">
    <h2 class="admin-section-title">Hoàn tiền</h2>
    <p style="margin: 0 0 12px; font-size: 13px" data-testid="admin-refund-totals">
      Đã nhận <strong>{{ formatVnd(order.received) }}</strong> · đã hoàn
      <strong>{{ formatVnd(order.refunded) }}</strong> · đang hoàn <strong>{{ formatVnd(order.refunding) }}</strong> ·
      còn hoàn được <strong>{{ formatVnd(order.refundable) }}</strong>
    </p>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div
      v-for="refund in order.refunds"
      :key="refund.id"
      data-testid="admin-refund"
      style="border-top: 1px solid var(--adm-border); padding: 12px 0; font-size: 13px"
    >
      <div style="display: flex; justify-content: space-between; gap: 12px">
        <div>
          <div style="font-weight: 600">{{ formatVnd(refund.amount) }}</div>
          <div style="color: var(--adm-muted); font-size: 12px">
            {{ REFUND_ORIGIN_LABELS[refund.origin] }} · {{ refund.createdBy.name }} ·
            {{ formatDateTime(refund.createdAt) }}
          </div>
        </div>
        <div style="white-space: nowrap; font-size: 12px" data-testid="admin-refund-status">
          {{ REFUND_STATUS_LABELS[refund.status] }}
        </div>
      </div>

      <div style="margin-top: 6px; font-size: 12px; color: var(--adm-muted)">
        <div v-if="refund.method === 'manual'">
          Chuyển khoản · mã {{ refund.bankReference }} · ngày {{ formatDateOnly(refund.transferredOn!) }}
          <span v-if="refund.executedBy"> · {{ refund.executedBy.name }}</span>
        </div>
        <div v-else-if="refund.method === 'vnpay'">
          Qua VNPAY<span v-if="refund.executedBy"> · {{ refund.executedBy.name }}</span>
          <span v-if="refund.executedAt"> · {{ formatDateTime(refund.executedAt) }}</span>
        </div>
        <div v-if="refund.settledBy">
          Chốt bởi {{ refund.settledBy.name
          }}<span v-if="refund.completedAt"> · {{ formatDateTime(refund.completedAt) }}</span>
        </div>
        <div v-if="refund.note" style="color: var(--adm-ink); white-space: pre-line; margin-top: 2px">
          Ghi chú: {{ refund.note }}
        </div>
        <div v-if="refund.retriedById">Đã tạo lại</div>
      </div>

      <template v-if="canRefund">
        <div
          v-if="refund.status === 'pending' && order.gatewayRefundable >= refund.amount"
          style="margin-top: 10px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap"
        >
          <button
            type="button"
            class="btn btn-primary btn-sm"
            data-testid="refund-gateway"
            :disabled="busy"
            @click="viaGateway(refund)"
          >
            Hoàn qua VNPAY
          </button>
          <span style="font-size: 12px; color: var(--adm-muted)">hoặc chuyển khoản rồi ghi lại bên dưới</span>
        </div>
        <form
          v-if="refund.status === 'pending'"
          style="margin-top: 10px"
          data-testid="refund-manual-form"
          @submit.prevent="recordManual(refund)"
        >
          <div style="display: grid; grid-template-columns: 1fr auto; gap: 8px">
            <div class="form-group" style="margin: 0">
              <label class="form-label" :for="`refund-ref-${refund.id}`" style="font-size: 12px">
                Mã giao dịch ngân hàng
              </label>
              <input
                :id="`refund-ref-${refund.id}`"
                v-model="draft(refund).bankReference"
                class="form-input"
                maxlength="100"
                required
              />
            </div>
            <div class="form-group" style="margin: 0">
              <label class="form-label" :for="`refund-day-${refund.id}`" style="font-size: 12px">Ngày chuyển</label>
              <input
                :id="`refund-day-${refund.id}`"
                v-model="draft(refund).transferredOn"
                type="date"
                class="form-input"
                required
              />
            </div>
          </div>
          <div class="form-group" style="margin: 8px 0">
            <label class="form-label" :for="`refund-note-${refund.id}`" style="font-size: 12px">
              Ghi chú (không ghi số tài khoản của khách)
            </label>
            <input :id="`refund-note-${refund.id}`" v-model="draft(refund).note" class="form-input" maxlength="2000" />
          </div>
          <button
            type="submit"
            class="btn btn-primary btn-sm"
            data-testid="refund-manual"
            :disabled="busy || !draft(refund).bankReference.trim()"
          >
            Ghi chuyển khoản
          </button>
        </form>

        <div v-else-if="refund.status === 'processing'" style="margin-top: 10px">
          <div class="form-group" style="margin-bottom: 8px">
            <label class="form-label" :for="`refund-settle-${refund.id}`" style="font-size: 12px">
              Ghi chú: đã kiểm gì trên cổng merchant
            </label>
            <input
              :id="`refund-settle-${refund.id}`"
              v-model="draft(refund).note"
              class="form-input"
              maxlength="2000"
            />
          </div>
          <div style="display: flex; gap: 8px">
            <button
              type="button"
              class="btn btn-primary btn-sm"
              data-testid="refund-settle-succeeded"
              :disabled="busy || !draft(refund).note.trim()"
              @click="settle(refund, 'succeeded')"
            >
              Đánh dấu đã hoàn
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              data-testid="refund-settle-failed"
              :disabled="busy || !draft(refund).note.trim()"
              @click="settle(refund, 'failed')"
            >
              Đánh dấu thất bại
            </button>
          </div>
        </div>

        <form
          v-else-if="refund.status === 'failed' && !refund.retriedById"
          style="margin-top: 10px"
          @submit.prevent="retry(refund)"
        >
          <div class="form-group" style="margin-bottom: 8px">
            <label class="form-label" :for="`refund-retry-${refund.id}`" style="font-size: 12px">
              Số tiền tạo lại (tối đa {{ formatVnd(refund.amount) }})
            </label>
            <input
              :id="`refund-retry-${refund.id}`"
              v-model.number="draft(refund).amount"
              type="number"
              min="1"
              :max="refund.amount"
              class="form-input"
              required
            />
          </div>
          <button type="submit" class="btn btn-secondary btn-sm" data-testid="refund-retry" :disabled="busy">
            Tạo lại
          </button>
        </form>
      </template>
    </div>
  </div>
</template>
