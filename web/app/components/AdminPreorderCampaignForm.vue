<script setup lang="ts">
import {
  PreorderSupplyStatus,
  type AdminProduct,
  type FieldError,
  type PreorderCampaign,
  type PreorderCampaignUpdate,
} from '@ecommerce/shared'

/**
 * Form mở hoặc sửa đợt đặt trước. Biến thể lấy từ sản phẩm (khi người dùng xem được sản phẩm) cộng với biến thể đã có
 * trong đợt. Khi đợt đã có đơn thì khóa mức cọc, số ngày trả phần còn lại và việc bỏ biến thể đã có đơn; đợt đã đóng
 * thì khóa hạn đóng. Server vẫn kiểm lại mọi điều này.
 */
const props = defineProps<{
  product: AdminProduct | null
  campaign?: PreorderCampaign | null
  busy?: boolean
  errors?: FieldError[]
  submitLabel: string
}>()
const emit = defineEmits<{
  submit: [body: PreorderCampaignUpdate]
  cancel: []
}>()

type Row = {
  variantId: string
  sku: string
  label: string
  active: boolean
  used: number
  selected: boolean
  allocation: number | null
}

const campaign = computed(() => props.campaign ?? null)
const hasOrders = computed(() => campaign.value?.variants.some((v) => v.used > 0) ?? false)
const closed = computed(() => campaign.value !== null && !campaign.value.isOpen)
const initialClosesAt = campaign.value ? toDateTimeLocal(campaign.value.closesAt) : ''

const form = reactive({
  depositPercent: campaign.value?.depositPercent ?? 30,
  deliveryFrom: campaign.value?.deliveryFrom ?? '',
  deliveryTo: campaign.value?.deliveryTo ?? '',
  closesAt: initialClosesAt,
  remainderDays: campaign.value?.remainderDays ?? 7,
  supplyStatus: campaign.value?.supplyStatus ?? 'not_ordered',
  supplyNote: campaign.value?.supplyNote ?? '',
})

function buildRows(): Row[] {
  const inCampaign = new Map((campaign.value?.variants ?? []).map((v) => [v.variantId, v]))
  const rows: Row[] = (campaign.value?.variants ?? []).map((v) => ({
    variantId: v.variantId,
    sku: v.sku,
    label: variantLabel(v.attributes),
    active: v.status === 'active',
    used: v.used,
    selected: true,
    allocation: v.allocation,
  }))
  for (const v of props.product?.variants ?? []) {
    if (inCampaign.has(v.id)) continue
    rows.push({
      variantId: v.id,
      sku: v.sku,
      label: variantLabel(v.attributes),
      active: v.status === 'active',
      used: 0,
      selected: false,
      allocation: null,
    })
  }
  return rows
}
const rows = ref<Row[]>(buildRows())
watch(
  () => [props.product, props.campaign],
  () => (rows.value = buildRows()),
)

const errorAt = (path: string) => props.errors?.find((f) => f.path === path)?.message
/** Lỗi theo dòng biến thể: server đánh số theo danh sách biến thể đã chọn, không theo bảng. */
const rowError = (row: Row, field: 'variantId' | 'allocation') => {
  const index = rows.value.filter((r) => r.selected).indexOf(row)
  return index >= 0 ? errorAt(`variants.${index}.${field}`) : undefined
}

function submit() {
  const variants = rows.value
    .filter((r) => r.selected)
    .map((r) => ({ variantId: r.variantId, allocation: r.allocation ?? 0 }))
  const body = {
    deliveryFrom: form.deliveryFrom,
    deliveryTo: form.deliveryTo,
    supplyStatus: form.supplyStatus,
    supplyNote: form.supplyNote,
    variants,
    ...(!hasOrders.value && { depositPercent: form.depositPercent, remainderDays: form.remainderDays }),
    // Ô giờ chỉ tới phút: không động vào thì không gửi, để server không coi là đổi hạn.
    ...(form.closesAt !== initialClosesAt && { closesAt: new Date(form.closesAt).toISOString() }),
  }
  emit('submit', body)
}
</script>

<template>
  <form @submit.prevent="submit">
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px">
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="preorder-deposit">Mức cọc (%) *</label>
        <input
          id="preorder-deposit"
          v-model.number="form.depositPercent"
          type="number"
          min="10"
          max="100"
          step="1"
          class="form-input"
          required
          :disabled="hasOrders"
        />
        <small v-if="hasOrders" class="form-help">Đợt đã có đơn, không đổi được.</small>
        <small class="field-error-msg">{{ errorAt('depositPercent') }}</small>
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="preorder-delivery-from">Giao dự kiến từ ngày *</label>
        <input id="preorder-delivery-from" v-model="form.deliveryFrom" type="date" class="form-input" required />
        <small class="field-error-msg">{{ errorAt('deliveryFrom') }}</small>
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="preorder-delivery-to">đến ngày *</label>
        <input id="preorder-delivery-to" v-model="form.deliveryTo" type="date" class="form-input" required />
        <small class="field-error-msg">{{ errorAt('deliveryTo') }}</small>
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="preorder-closes-at">Hạn đóng nhận đặt *</label>
        <input
          id="preorder-closes-at"
          v-model="form.closesAt"
          type="datetime-local"
          class="form-input"
          required
          :disabled="closed"
        />
        <small v-if="closed" class="form-help">Đợt đã đóng.</small>
        <small class="field-error-msg">{{ errorAt('closesAt') }}</small>
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="preorder-remainder-days">Số ngày trả phần còn lại *</label>
        <input
          id="preorder-remainder-days"
          v-model.number="form.remainderDays"
          type="number"
          min="1"
          max="90"
          step="1"
          class="form-input"
          required
          :disabled="hasOrders"
        />
        <small class="field-error-msg">{{ errorAt('remainderDays') }}</small>
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="preorder-supply-status">Tiến độ nhập hàng</label>
        <select id="preorder-supply-status" v-model="form.supplyStatus" class="form-input">
          <option v-for="status in PreorderSupplyStatus.options" :key="status" :value="status">
            {{ PREORDER_SUPPLY_LABELS[status] }}
          </option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom: 0; grid-column: 1 / -1">
        <label class="form-label" for="preorder-supply-note">Ghi chú nội bộ (khách không thấy)</label>
        <input id="preorder-supply-note" v-model="form.supplyNote" class="form-input" maxlength="2000" />
      </div>
    </div>

    <table class="admin-table" style="margin-top: 16px">
      <thead>
        <tr>
          <th style="width: 40px">Nhận đặt</th>
          <th>SKU</th>
          <th>Biến thể</th>
          <th class="admin-table-num">Đã đặt</th>
          <th class="admin-table-num" style="min-width: 110px">Số suất</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.variantId">
          <td>
            <input
              v-model="row.selected"
              type="checkbox"
              :aria-label="`Nhận đặt ${row.sku}`"
              :disabled="row.used > 0 || (!row.active && !row.selected)"
            />
          </td>
          <td style="font-family: var(--adm-mono); font-size: 12px; font-weight: 600">{{ row.sku }}</td>
          <td style="font-size: 12px">
            {{ row.label || '—' }}
            <span v-if="!row.active" style="color: var(--adm-muted)">(ngừng bán)</span>
            <small class="field-error-msg">{{ rowError(row, 'variantId') }}</small>
          </td>
          <td class="admin-table-num">{{ row.used }}</td>
          <td>
            <input
              v-model.number="row.allocation"
              :aria-label="`Số suất ${row.sku}`"
              type="number"
              :min="Math.max(1, row.used)"
              step="1"
              class="form-input admin-table-num"
              :required="row.selected"
              :disabled="!row.selected"
            />
            <small class="field-error-msg">{{ rowError(row, 'allocation') }}</small>
          </td>
        </tr>
      </tbody>
    </table>
    <small class="field-error-msg">{{ errorAt('variants') }}</small>

    <div style="display: flex; gap: 8px; margin-top: 12px">
      <button type="submit" class="btn btn-primary btn-sm" :disabled="busy">{{ submitLabel }}</button>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="emit('cancel')">Hủy</button>
    </div>
  </form>
</template>
