<script setup lang="ts">
import {
  AdminBrandList,
  AdminCategoryList,
  OrderKind,
  VOUCHER_MAX_PERCENT,
  type AdminBrand,
  type AdminCategory,
  type FieldError,
  type Voucher,
  type VoucherCreate,
  type VoucherKind,
} from '@ecommerce/shared'

/**
 * Form to create or edit a voucher. Once used, only description, end time and total uses can change; the server
 * rechecks. Brands and categories come from the catalog admin (needs `catalog.edit`, which owner and sales have).
 */
const props = defineProps<{
  voucher?: Voucher | null
  busy?: boolean
  errors?: FieldError[]
  submitLabel: string
}>()
const emit = defineEmits<{
  submit: [body: Partial<VoucherCreate>]
  cancel: []
}>()

const session = useAdminSession()
const voucher = computed(() => props.voucher ?? null)
const locked = computed(() => (voucher.value?.used ?? 0) > 0)
const initialStartsAt = voucher.value ? toDateTimeLocal(voucher.value.startsAt) : ''
const initialEndsAt = voucher.value ? toDateTimeLocal(voucher.value.endsAt) : ''

const form = reactive({
  code: voucher.value?.code ?? '',
  description: voucher.value?.description ?? '',
  kind: (voucher.value?.kind ?? 'percent') as VoucherKind,
  amount: voucher.value?.amount ?? null,
  percent: voucher.value?.percent ?? null,
  maxDiscount: voucher.value?.maxDiscount ?? null,
  minSubtotal: voucher.value?.minSubtotal ?? 0,
  startsAt: initialStartsAt,
  endsAt: initialEndsAt,
  saleTypes: [...(voucher.value?.saleTypes ?? OrderKind.options)],
  totalLimit: voucher.value?.totalLimit ?? null,
  perCustomerLimit: voucher.value?.perCustomerLimit ?? 1,
  brandIds: voucher.value?.brands.map((b) => b.id) ?? [],
  categoryIds: voucher.value?.categories.map((c) => c.id) ?? [],
})

const brands = ref<AdminBrand[]>([])
const categories = ref<AdminCategory[]>([])
const loadError = ref<string | null>(null)
// Do not await in setup: the form sits in the detail page's `v-if`, and an async component would not show until loaded.
onMounted(async () => {
  try {
    const [brandList, categoryList] = await Promise.all([
      session.adminFetch('/api/admin/brands'),
      session.adminFetch('/api/admin/categories'),
    ])
    brands.value = AdminBrandList.parse(brandList).items.sort((a, b) => a.name.localeCompare(b.name))
    categories.value = AdminCategoryList.parse(categoryList).items.sort(
      (a, b) => a.productType.localeCompare(b.productType) || a.name.localeCompare(b.name),
    )
  } catch (err) {
    loadError.value = apiErrorMessage(err)
  }
})

const errorAt = (path: string) => props.errors?.find((f) => f.path === path || f.path.startsWith(`${path}.`))?.message

/** Empty number fields become `null`. */
const numberOrNull = (value: number | string | null) => (value === '' || value === null ? null : Number(value))

function submit() {
  const editable = {
    description: form.description,
    totalLimit: numberOrNull(form.totalLimit),
    // The time field only goes to the minute: if untouched, do not send it, so the server does not see a change.
    ...(form.endsAt !== initialEndsAt && { endsAt: new Date(form.endsAt).toISOString() }),
  }
  if (locked.value) return emit('submit', editable)
  const fixed = form.kind === 'fixed'
  emit('submit', {
    ...editable,
    ...(!voucher.value && { code: form.code }),
    kind: form.kind,
    amount: fixed ? numberOrNull(form.amount) : null,
    percent: fixed ? null : numberOrNull(form.percent),
    maxDiscount: fixed ? null : numberOrNull(form.maxDiscount),
    minSubtotal: numberOrNull(form.minSubtotal) ?? 0,
    ...(form.startsAt !== initialStartsAt && { startsAt: new Date(form.startsAt).toISOString() }),
    saleTypes: form.saleTypes,
    perCustomerLimit: numberOrNull(form.perCustomerLimit) ?? 1,
    brandIds: form.brandIds,
    categoryIds: form.categoryIds,
  })
}
</script>

<template>
  <form @submit.prevent="submit">
    <p v-if="locked" class="form-help" style="margin: 0 0 12px">
      Mã đã có {{ voucher?.used }} lượt dùng: chỉ đổi được mô tả, thời điểm kết thúc và tổng lượt.
    </p>
    <div v-if="loadError" class="admin-alert admin-alert-danger" role="alert" style="margin-bottom: 12px">
      <span>Không tải được thương hiệu và danh mục: {{ loadError }}</span>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px">
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="voucher-code">Mã *</label>
        <input
          id="voucher-code"
          v-model="form.code"
          class="form-input"
          style="font-family: var(--adm-mono); text-transform: uppercase"
          maxlength="20"
          required
          :disabled="!!voucher"
        />
        <small class="form-help">4–20 chữ cái hoặc chữ số; khách gõ không phân biệt hoa thường.</small>
        <small class="field-error-msg">{{ errorAt('code') }}</small>
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="voucher-kind">Loại giảm *</label>
        <select id="voucher-kind" v-model="form.kind" class="form-input" :disabled="locked">
          <option value="percent">Theo tỷ lệ</option>
          <option value="fixed">Số tiền cố định</option>
        </select>
      </div>
      <template v-if="form.kind === 'fixed'">
        <div class="form-group" style="margin-bottom: 0">
          <label class="form-label" for="voucher-amount">Số tiền giảm (₫) *</label>
          <input
            id="voucher-amount"
            v-model.number="form.amount"
            type="number"
            min="1000"
            step="1000"
            class="form-input"
            required
            :disabled="locked"
          />
          <small class="field-error-msg">{{ errorAt('amount') }}</small>
        </div>
      </template>
      <template v-else>
        <div class="form-group" style="margin-bottom: 0">
          <label class="form-label" for="voucher-percent">Tỷ lệ giảm (%) *</label>
          <input
            id="voucher-percent"
            v-model.number="form.percent"
            type="number"
            min="1"
            :max="VOUCHER_MAX_PERCENT"
            step="1"
            class="form-input"
            required
            :disabled="locked"
          />
          <small class="field-error-msg">{{ errorAt('percent') }}</small>
        </div>
        <div class="form-group" style="margin-bottom: 0">
          <label class="form-label" for="voucher-max">Giảm tối đa (₫) *</label>
          <input
            id="voucher-max"
            v-model.number="form.maxDiscount"
            type="number"
            min="1000"
            step="1000"
            class="form-input"
            required
            :disabled="locked"
          />
          <small class="field-error-msg">{{ errorAt('maxDiscount') }}</small>
        </div>
      </template>
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="voucher-min">Đơn tối thiểu (₫)</label>
        <input
          id="voucher-min"
          v-model.number="form.minSubtotal"
          type="number"
          min="0"
          step="1000"
          class="form-input"
          :disabled="locked"
        />
        <small class="form-help">Tính trên tiền hàng thuộc phạm vi, trước giảm.</small>
        <small class="field-error-msg">{{ errorAt('minSubtotal') }}</small>
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="voucher-starts">Bắt đầu *</label>
        <input
          id="voucher-starts"
          v-model="form.startsAt"
          type="datetime-local"
          class="form-input"
          required
          :disabled="locked"
        />
        <small class="field-error-msg">{{ errorAt('startsAt') }}</small>
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="voucher-ends">Kết thúc *</label>
        <input id="voucher-ends" v-model="form.endsAt" type="datetime-local" class="form-input" required />
        <small class="field-error-msg">{{ errorAt('endsAt') }}</small>
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="voucher-total">Tổng lượt</label>
        <input
          id="voucher-total"
          v-model.number="form.totalLimit"
          type="number"
          :min="Math.max(1, voucher?.used ?? 0)"
          step="1"
          class="form-input"
          placeholder="Không giới hạn"
        />
        <small class="field-error-msg">{{ errorAt('totalLimit') }}</small>
      </div>
      <div class="form-group" style="margin-bottom: 0">
        <label class="form-label" for="voucher-per-customer">Lượt mỗi khách *</label>
        <input
          id="voucher-per-customer"
          v-model.number="form.perCustomerLimit"
          type="number"
          min="1"
          step="1"
          class="form-input"
          required
          :disabled="locked"
        />
        <small class="form-help">Nhận diện khách theo email hoặc số điện thoại.</small>
        <small class="field-error-msg">{{ errorAt('perCustomerLimit') }}</small>
      </div>
      <fieldset class="form-group" style="margin-bottom: 0; border: 0; padding: 0">
        <legend class="form-label">Hình thức bán *</legend>
        <label v-for="type in OrderKind.options" :key="type" style="display: flex; gap: 6px; align-items: center">
          <input v-model="form.saleTypes" type="checkbox" :value="type" :disabled="locked" />
          {{ SALE_TYPE_LABELS[type] }}
        </label>
        <small class="field-error-msg">{{ errorAt('saleTypes') }}</small>
      </fieldset>
      <div class="form-group" style="margin-bottom: 0; grid-column: 1 / -1">
        <label class="form-label" for="voucher-description">Ghi chú nội bộ (khách không thấy)</label>
        <input id="voucher-description" v-model="form.description" class="form-input" maxlength="500" />
      </div>
    </div>

    <div
      style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 16px"
    >
      <fieldset style="border: 1px solid var(--adm-border); border-radius: 8px; padding: 10px 14px">
        <legend class="form-label">Thương hiệu (để trống là mọi thương hiệu)</legend>
        <div style="max-height: 220px; overflow-y: auto">
          <label v-for="b in brands" :key="b.id" style="display: flex; gap: 6px; align-items: center">
            <input v-model="form.brandIds" type="checkbox" :value="b.id" :disabled="locked" />
            {{ b.name }}
          </label>
        </div>
        <small class="field-error-msg">{{ errorAt('brandIds') }}</small>
      </fieldset>
      <fieldset style="border: 1px solid var(--adm-border); border-radius: 8px; padding: 10px 14px">
        <legend class="form-label">Danh mục, gồm cả danh mục con (để trống là mọi danh mục)</legend>
        <div style="max-height: 220px; overflow-y: auto">
          <label v-for="c in categories" :key="c.id" style="display: flex; gap: 6px; align-items: center">
            <input v-model="form.categoryIds" type="checkbox" :value="c.id" :disabled="locked" />
            {{ PRODUCT_TYPE_LABELS[c.productType] }} › {{ c.name }}
          </label>
        </div>
        <small class="field-error-msg">{{ errorAt('categoryIds') }}</small>
      </fieldset>
    </div>

    <div style="display: flex; gap: 8px; margin-top: 12px">
      <button type="submit" class="btn btn-primary btn-sm" :disabled="busy">{{ submitLabel }}</button>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="emit('cancel')">Hủy</button>
    </div>
  </form>
</template>
