<script setup lang="ts">
import { AdminSupportRequest, type FieldError } from '@ecommerce/shared'

/**
 * Khối trả hàng hay đổi hàng ở trang yêu cầu (spec M6b ticket 04, 05): hạn đổi trả chụp lúc gửi, chấp nhận hay từ chối kèm lời nhắn cho
 * khách (`support.handle`), kho nhận hàng về theo từng dòng (`order.fulfill`), đề xuất hoàn (`support.handle`). Thao tác
 * xong emit yêu cầu mới do API trả. Đổi hàng: sau khi nhận hàng cũ, kho bàn giao biến thể mới kèm mã vận đơn.
 */
const props = defineProps<{ request: AdminSupportRequest }>()
const emit = defineEmits<{ update: [request: AdminSupportRequest] }>()

const session = useAdminSession()
const canHandle = computed(() => session.can('support.handle'))
const canReceive = computed(() => session.can('order.fulfill'))
const busy = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref<FieldError[]>([])
const errorAt = (path: string) => fieldErrors.value.find((f) => f.path === path)?.message

const closed = computed(() => isSupportClosed(props.request.status))
const decisionMessage = ref('')
const received = ref(props.request.lines.map((line) => ({ restocked: line.quantity, writtenOff: 0 })))
const receiveValid = computed(() =>
  props.request.lines.every((line, i) => {
    const r = received.value[i]!
    return r.restocked >= 0 && r.writtenOff >= 0 && r.restocked + r.writtenOff === line.quantity
  }),
)
const refund = reactive({ amount: props.request.returnRefund?.suggested ?? 0, note: '', message: '' })
watch(
  () => props.request.returnRefund?.suggested,
  (suggested) => {
    if (suggested !== undefined) refund.amount = suggested
  },
)
const isExchange = computed(() => props.request.kind === 'exchange')
const shipment = reactive({ carrier: '', trackingNumber: '' })
const ship = () =>
  act(
    'exchange-ship',
    { ...shipment },
    'Bàn giao hàng đổi cho đơn vị vận chuyển? Tồn biến thể mới bị trừ và yêu cầu sẽ xong.',
  )
const reduced = computed(() => refund.amount < (props.request.returnRefund?.suggested ?? 0))

async function act(path: string, body: Record<string, unknown>, confirmText: string) {
  if (!confirm(confirmText)) return
  busy.value = true
  error.value = null
  fieldErrors.value = []
  try {
    emit(
      'update',
      AdminSupportRequest.parse(
        await session.adminFetch(`/api/admin/support-requests/${props.request.code}/${path}`, { method: 'POST', body }),
      ),
    )
  } catch (err) {
    error.value = apiErrorMessage(err)
    fieldErrors.value = apiFieldErrors(err)
  } finally {
    busy.value = false
  }
}

const decide = (decision: 'accepted' | 'rejected') =>
  act(
    'decide',
    { decision, message: decisionMessage.value },
    decision === 'accepted'
      ? isExchange.value
        ? 'Chấp nhận đổi hàng? Hàng biến thể mới được giữ ngay; khách nhận email kèm lời nhắn của bạn.'
        : 'Chấp nhận trả hàng? Khách nhận email kèm lời nhắn của bạn.'
      : 'Từ chối yêu cầu? Yêu cầu sẽ kết thúc và khách nhận email kèm lý do.',
  )
const receive = () =>
  act(
    'receive',
    { lines: props.request.lines.map((line, i) => ({ lineId: line.id, ...received.value[i]! })) },
    'Ghi nhận đã nhận hàng về? Phần nhập lại sẽ vào tồn, không hoàn tác được.',
  )
const proposeRefund = () =>
  act(
    'refund',
    { refundAmount: refund.amount, note: refund.note.trim() || undefined, message: refund.message.trim() || undefined },
    refund.amount > 0
      ? `Đề xuất hoàn ${formatVnd(refund.amount)}? Yêu cầu sẽ xong, kế toán thực hiện hoàn.`
      : 'Đóng yêu cầu mà không hoàn tiền?',
  )
</script>

<template>
  <div class="admin-panel" style="margin-bottom: 24px" data-testid="admin-support-return">
    <h2 class="admin-section-title">{{ isExchange ? 'Đổi hàng' : 'Trả hàng' }}</h2>

    <div
      v-if="request.exchangeOverdueAt && !request.receivedAt && !closed"
      class="admin-alert admin-alert-danger"
      role="alert"
      style="font-size: 12px"
      data-testid="admin-exchange-overdue"
    >
      <span>
        Đã chấp nhận quá 14 ngày mà chưa nhận được hàng khách gửi (gắn cờ
        {{ formatDateTime(request.exchangeOverdueAt) }}). Hàng mới vẫn đang giữ; liên hệ khách hoặc đóng yêu cầu để nhả
        hàng.
      </span>
    </div>

    <p v-if="request.returnWindow" style="margin: 0 0 12px; font-size: 13px" data-testid="admin-support-window">
      <template v-if="request.returnWindow.days === null">Nhóm hàng chưa cấu hình hạn đổi trả.</template>
      <template v-else>
        Hạn đổi trả {{ request.returnWindow.days }} ngày từ lúc giao<template v-if="request.returnWindow.deliveredAt">
          ({{ formatDateTime(request.returnWindow.deliveredAt) }})</template
        >.
        <strong v-if="request.returnWindow.overdueDays" style="color: var(--adm-danger)">
          Đã quá hạn {{ request.returnWindow.overdueDays }} ngày lúc khách gửi.
        </strong>
      </template>
    </p>

    <table class="admin-table" style="margin-bottom: 12px">
      <thead>
        <tr>
          <th>Sản phẩm</th>
          <th class="admin-table-num">{{ isExchange ? 'Số đổi' : 'Số trả' }}</th>
          <th>{{ isExchange ? 'Đổi sang' : 'Lý do' }}</th>
          <th v-if="request.receivedAt" class="admin-table-num">Nhập lại / hỏng</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="line in request.lines" :key="line.id">
          <td>
            {{ line.productName }}
            <div style="font-family: var(--adm-mono); font-size: 12px">{{ line.heldSku }}</div>
          </td>
          <td class="admin-table-num">{{ line.quantity }}</td>
          <td v-if="isExchange">
            <span style="font-family: var(--adm-mono); font-size: 12px">{{ line.toSku }}</span>
            <div v-if="line.reservedQuantity" style="font-size: 11px; color: var(--adm-muted)">
              đang giữ {{ line.reservedQuantity }}
            </div>
          </td>
          <td v-else>{{ line.reason ? RETURN_REASON_LABELS[line.reason] : '—' }}</td>
          <td v-if="request.receivedAt" class="admin-table-num">
            {{ line.restockedQuantity }} / {{ line.writtenOffQuantity }}
          </td>
        </tr>
      </tbody>
    </table>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert" style="font-size: 12px">
      <span>{{ error }}</span>
    </div>

    <p v-if="request.decision" style="margin: 0 0 12px; font-size: 13px; color: var(--adm-muted)">
      {{ request.decision === 'accepted' ? 'Đã chấp nhận' : 'Đã từ chối' }}
      <template v-if="request.decidedBy"> · {{ request.decidedBy.name }}</template>
      <template v-if="request.decidedAt"> · {{ formatDateTime(request.decidedAt) }}</template>
      <template v-if="request.receivedAt">
        · nhận hàng về {{ formatDateTime(request.receivedAt)
        }}<template v-if="request.receivedBy"> ({{ request.receivedBy.name }})</template>
      </template>
    </p>

    <!-- Bước 1: chấp nhận hay từ chối. -->
    <form v-if="!request.decision && !closed && canHandle" @submit.prevent>
      <div class="form-group">
        <label class="form-label" for="return-decision-message">
          Lời nhắn cho khách (hướng dẫn gửi hàng, hay lý do từ chối)
        </label>
        <textarea
          id="return-decision-message"
          v-model="decisionMessage"
          class="form-textarea"
          rows="3"
          maxlength="5000"
          data-testid="return-decision-message"
        />
      </div>
      <div style="display: flex; gap: 8px">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          data-testid="return-accept"
          :disabled="busy || !decisionMessage.trim()"
          @click="decide('accepted')"
        >
          Chấp nhận
        </button>
        <button
          type="button"
          class="btn btn-danger btn-sm"
          data-testid="return-reject"
          :disabled="busy || !decisionMessage.trim()"
          @click="decide('rejected')"
        >
          Từ chối
        </button>
      </div>
    </form>

    <!-- Bước 2: kho nhận hàng về. -->
    <form
      v-else-if="request.decision === 'accepted' && !request.receivedAt && !closed && canReceive"
      data-testid="return-receive"
      @submit.prevent="receive"
    >
      <div class="form-label" style="margin-bottom: 6px">Nhận hàng khách gửi về</div>
      <div
        v-for="(line, i) in request.lines"
        :key="line.id"
        style="display: grid; grid-template-columns: 1fr 90px 90px; gap: 8px; align-items: end; margin-bottom: 8px"
      >
        <div style="font-size: 12px">
          <div style="font-family: var(--adm-mono)">{{ line.heldSku }}</div>
          <div style="color: var(--adm-muted)">× {{ line.quantity }}</div>
        </div>
        <div>
          <label class="form-label" :for="`return-restock-${i}`" style="font-size: 11px">Nhập lại tồn</label>
          <input
            :id="`return-restock-${i}`"
            v-model.number="received[i]!.restocked"
            type="number"
            min="0"
            :max="line.quantity"
            class="form-input"
          />
        </div>
        <div>
          <label class="form-label" :for="`return-writeoff-${i}`" style="font-size: 11px">Hỏng</label>
          <input
            :id="`return-writeoff-${i}`"
            v-model.number="received[i]!.writtenOff"
            type="number"
            min="0"
            :max="line.quantity"
            class="form-input"
          />
        </div>
        <small v-if="errorAt(`lines.${i}`)" class="field-error-msg" style="grid-column: 1 / -1">
          {{ errorAt(`lines.${i}`) }}
        </small>
      </div>
      <button type="submit" class="btn btn-primary btn-sm" :disabled="busy || !receiveValid">Ghi nhận hàng về</button>
    </form>
    <p
      v-else-if="request.decision === 'accepted' && !request.receivedAt && !closed"
      style="margin: 0; font-size: 13px; color: var(--adm-muted)"
    >
      Chờ kho nhận hàng khách gửi về.
    </p>

    <!-- Đổi hàng, bước 3: kho bàn giao biến thể mới. -->
    <p v-if="request.exchangeShipment" style="margin: 0; font-size: 13px" data-testid="admin-exchange-shipment">
      Đã gửi hàng đổi qua {{ request.exchangeShipment.carrier }}, mã vận đơn
      <strong>{{ request.exchangeShipment.trackingNumber }}</strong> ·
      {{ formatDateTime(request.exchangeShipment.handedOverAt) }}
    </p>
    <form
      v-else-if="isExchange && request.receivedAt && !closed && canReceive"
      data-testid="exchange-ship"
      @submit.prevent="ship"
    >
      <div class="form-label" style="margin-bottom: 6px">Gửi hàng đổi cho khách</div>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px">
        <div class="form-group">
          <label class="form-label" for="exchange-carrier">Đơn vị vận chuyển</label>
          <input id="exchange-carrier" v-model="shipment.carrier" class="form-input" maxlength="100" />
          <small class="field-error-msg">{{ errorAt('carrier') }}</small>
        </div>
        <div class="form-group">
          <label class="form-label" for="exchange-tracking">Mã vận đơn</label>
          <input id="exchange-tracking" v-model="shipment.trackingNumber" class="form-input" maxlength="100" />
          <small class="field-error-msg">{{ errorAt('trackingNumber') }}</small>
        </div>
      </div>
      <button
        type="submit"
        class="btn btn-primary btn-sm"
        :disabled="busy || !shipment.carrier.trim() || !shipment.trackingNumber.trim()"
      >
        Bàn giao hàng đổi
      </button>
    </form>

    <!-- Trả hàng, bước 3: đề xuất hoàn. -->
    <form v-if="request.returnRefund && canHandle" data-testid="return-refund" @submit.prevent="proposeRefund">
      <p style="margin: 0 0 8px; font-size: 13px">
        Gợi ý hoàn <strong>{{ formatVnd(request.returnRefund.suggested) }}</strong> (đã trừ phần giảm của mã, không gồm
        phí giao) · đơn còn hoàn được {{ formatVnd(request.returnRefund.refundable) }}
      </p>
      <div class="form-group">
        <label class="form-label" for="return-refund-amount">Số tiền hoàn (VND)</label>
        <input
          id="return-refund-amount"
          v-model.number="refund.amount"
          type="number"
          min="0"
          :max="request.returnRefund.refundable"
          class="form-input"
          data-testid="return-refund-amount"
        />
        <small class="field-error-msg">{{ errorAt('refundAmount') }}</small>
      </div>
      <div class="form-group">
        <label class="form-label" for="return-refund-note">
          Ghi chú nội bộ{{ reduced ? ' (bắt buộc khi hoàn ít hơn gợi ý)' : '' }}
        </label>
        <input id="return-refund-note" v-model="refund.note" class="form-input" maxlength="2000" />
        <small class="field-error-msg">{{ errorAt('note') }}</small>
      </div>
      <div class="form-group">
        <label class="form-label" for="return-refund-message"
          >Lời nhắn cho khách (để trống thì dùng câu mặc định)</label
        >
        <textarea id="return-refund-message" v-model="refund.message" class="form-textarea" rows="2" maxlength="5000" />
      </div>
      <button
        type="submit"
        class="btn btn-primary btn-sm"
        data-testid="return-refund-submit"
        :disabled="busy || (reduced && !refund.note.trim())"
      >
        Đề xuất hoàn và đóng yêu cầu
      </button>
    </form>

    <ul v-if="request.refunds.length" style="margin: 12px 0 0; padding-left: 18px; font-size: 13px">
      <li v-for="r in request.refunds" :key="r.id">
        Khoản hoàn {{ formatVnd(r.amount) }} ·
        {{ REFUND_STATUS_LABELS[r.status as keyof typeof REFUND_STATUS_LABELS] ?? r.status }}
      </li>
    </ul>
  </div>
</template>
