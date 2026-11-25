<script setup lang="ts">
import { AdminSupportRequest, type FieldError, type WarrantyOutcome } from '@ecommerce/shared'

/**
 * Warranty block on the request page (spec M6b ticket 06): a warning when the product has no warranty commitment, the
 * received → sent/repaired → returned milestones, and the outcome. "Đổi mới" and "hoàn tiền" create a follow-up
 * request, so they ask first. No milestone touches stock. Emits the new request the API returns.
 */
const props = defineProps<{ request: AdminSupportRequest }>()
const emit = defineEmits<{ update: [request: AdminSupportRequest] }>()

const session = useAdminSession()
const canHandle = computed(() => session.can('support.handle'))
const busy = ref(false)
const error = ref<string | null>(null)
const fieldErrors = ref<FieldError[]>([])
const errorAt = (path: string) => fieldErrors.value.find((f) => f.path === path)?.message

const w = computed(() => props.request.warranty!)
const open = computed(() => !isSupportClosed(props.request.status) && !w.value.outcome)
const back = reactive({ carrier: '', trackingNumber: '' })
const outcome = reactive({ value: '' as WarrantyOutcome | '', note: '' })

/** Outcomes available at the current milestone: repaired needs returned; replace and refund need received. */
const outcomes = computed(() =>
  (Object.keys(WARRANTY_OUTCOME_LABELS) as WarrantyOutcome[]).filter((o) =>
    o === 'repaired' ? !!w.value.returnedAt : o === 'rejected' ? true : !!w.value.receivedAt,
  ),
)

const CONFIRM: Record<WarrantyOutcome, string> = {
  repaired: 'Ghi kết quả "đã sửa xong"? Yêu cầu sẽ xong và khách nhận email.',
  rejected: 'Từ chối bảo hành? Yêu cầu sẽ kết thúc và khách nhận email kèm lý do.',
  replaced:
    'Đổi sản phẩm mới? Hệ thống tạo yêu cầu đổi cùng biến thể (đã chấp nhận, giữ hàng ngay); kho chỉ còn bàn giao.',
  refunded: 'Hoàn tiền? Hệ thống tạo yêu cầu trả hàng (đã chấp nhận, đã nhận hàng); bạn đề xuất hoàn ở yêu cầu đó.',
}

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

const milestone = (name: 'received' | 'sent') =>
  act(
    'warranty-milestone',
    { milestone: name },
    name === 'received' ? 'Ghi đã nhận sản phẩm của khách?' : 'Ghi đã gửi hãng hay đưa đi sửa?',
  )
const returned = () =>
  act('warranty-milestone', { milestone: 'returned', ...back }, 'Ghi đã gửi trả sản phẩm cho khách? Khách nhận email.')
const decide = () => {
  if (!outcome.value) return
  act('warranty-outcome', { outcome: outcome.value, note: outcome.note.trim() || undefined }, CONFIRM[outcome.value])
}
</script>

<template>
  <div class="admin-panel" style="margin-bottom: 24px" data-testid="admin-support-warranty">
    <h2 class="admin-section-title">Bảo hành</h2>

    <div
      v-if="request.hasWarrantyCommitment === false"
      class="admin-alert admin-alert-danger"
      role="alert"
      style="font-size: 12px"
      data-testid="admin-warranty-no-commitment"
    >
      <span>Sản phẩm này không có cam kết bảo hành. Kiểm tra trước khi nhận bảo hành cho khách.</span>
    </div>

    <table class="admin-table" style="margin-bottom: 12px">
      <tbody>
        <tr v-for="line in request.lines" :key="line.id">
          <td>
            {{ line.productName }}
            <div style="font-family: var(--adm-mono); font-size: 12px">{{ line.heldSku }}</div>
          </td>
          <td class="admin-table-num">× {{ line.quantity }}</td>
        </tr>
      </tbody>
    </table>

    <ol style="margin: 0 0 12px; padding-left: 18px; font-size: 13px" data-testid="admin-warranty-milestones">
      <li>
        Nhận sản phẩm của khách:
        <strong v-if="w.receivedAt">{{ formatDateTime(w.receivedAt) }}</strong>
        <span v-else style="color: var(--adm-muted)">chưa</span>
      </li>
      <li>
        Gửi hãng hay sửa:
        <strong v-if="w.sentAt">{{ formatDateTime(w.sentAt) }}</strong>
        <span v-else style="color: var(--adm-muted)">chưa</span>
      </li>
      <li>
        Trả lại khách:
        <template v-if="w.returnedAt">
          <strong>{{ formatDateTime(w.returnedAt) }}</strong>
          <template v-if="w.returnShipment">
            · {{ w.returnShipment.carrier }} {{ w.returnShipment.trackingNumber }}</template
          >
        </template>
        <span v-else style="color: var(--adm-muted)">chưa</span>
      </li>
    </ol>

    <p v-if="w.outcome" style="margin: 0 0 12px; font-size: 13px" data-testid="admin-warranty-outcome">
      Kết quả: <strong>{{ WARRANTY_OUTCOME_LABELS[w.outcome] }}</strong>
      <template v-if="w.outcomeNote"> · {{ w.outcomeNote }}</template>
    </p>
    <p v-if="request.followUps.length" style="margin: 0 0 12px; font-size: 13px">
      Yêu cầu nối tiếp:
      <template v-for="(f, i) in request.followUps" :key="f.code"
        >{{ i ? ', ' : '' }}<NuxtLink :to="`/admin/support/${f.code}`">#YC{{ f.code }}</NuxtLink> ({{
          SUPPORT_KIND_LABELS[f.kind]
        }})</template
      >
    </p>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert" style="font-size: 12px">
      <span>{{ error }}</span>
    </div>

    <template v-if="open && canHandle">
      <!-- Next milestone. -->
      <div style="display: flex; gap: 8px; margin-bottom: 12px">
        <button
          v-if="!w.receivedAt"
          type="button"
          class="btn btn-primary btn-sm"
          data-testid="warranty-received"
          :disabled="busy"
          @click="milestone('received')"
        >
          Đã nhận sản phẩm
        </button>
        <button
          v-else-if="!w.sentAt"
          type="button"
          class="btn btn-primary btn-sm"
          data-testid="warranty-sent"
          :disabled="busy"
          @click="milestone('sent')"
        >
          Đã gửi hãng / sửa
        </button>
      </div>
      <form v-if="w.sentAt && !w.returnedAt" data-testid="warranty-returned" @submit.prevent="returned">
        <div class="form-label" style="margin-bottom: 6px">Gửi trả sản phẩm cho khách</div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px">
          <div class="form-group">
            <label class="form-label" for="warranty-carrier">Đơn vị vận chuyển</label>
            <input id="warranty-carrier" v-model="back.carrier" class="form-input" maxlength="100" />
            <small class="field-error-msg">{{ errorAt('carrier') }}</small>
          </div>
          <div class="form-group">
            <label class="form-label" for="warranty-tracking">Mã vận đơn</label>
            <input id="warranty-tracking" v-model="back.trackingNumber" class="form-input" maxlength="100" />
            <small class="field-error-msg">{{ errorAt('trackingNumber') }}</small>
          </div>
        </div>
        <button
          type="submit"
          class="btn btn-outline btn-sm"
          style="margin-bottom: 12px"
          :disabled="busy || !back.carrier.trim() || !back.trackingNumber.trim()"
        >
          Ghi đã gửi trả
        </button>
      </form>

      <!-- Outcome. -->
      <form data-testid="warranty-outcome" @submit.prevent="decide">
        <div class="form-group">
          <label class="form-label" for="warranty-outcome-select">Kết quả</label>
          <select id="warranty-outcome-select" v-model="outcome.value" class="form-select">
            <option value="" disabled>Chọn kết quả</option>
            <option v-for="o in outcomes" :key="o" :value="o">{{ WARRANTY_OUTCOME_LABELS[o] }}</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="warranty-outcome-note">
            Lời nhắn cho khách{{ outcome.value === 'rejected' ? ' (bắt buộc: lý do từ chối)' : '' }}
          </label>
          <textarea id="warranty-outcome-note" v-model="outcome.note" class="form-textarea" rows="3" maxlength="5000" />
          <small class="field-error-msg">{{ errorAt('note') }}</small>
        </div>
        <button
          type="submit"
          class="btn btn-primary btn-sm"
          :disabled="busy || !outcome.value || (outcome.value === 'rejected' && !outcome.note.trim())"
        >
          Ghi kết quả
        </button>
      </form>
    </template>
  </div>
</template>
