<script setup lang="ts">
import {
  ADJUSTMENT_INPUT,
  AdminBrandList,
  ProductType,
  STOCK_VIEW_PERMISSIONS,
  StockAdjustmentReason,
  StockItem,
  StockPage,
  StockSort,
  VariantStatus,
  adjustmentDelta,
  type FieldError,
} from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: STOCK_VIEW_PERMISSIONS })

const PAGE_SIZE = 50
const SORT_LABELS: Record<StockSort, string> = {
  name: 'Theo tên sản phẩm',
  on_hand_asc: 'Tồn ít trước',
  on_hand_desc: 'Tồn nhiều trước',
}
const VARIANT_STATUS_LABELS: Record<VariantStatus, string> = { active: 'Đang bán', discontinued: 'Ngừng bán' }

const session = useAdminSession()
const canAdjust = computed(() => session.can('stock.adjust'))
const brands = ref<AdminBrandList['items']>([])
const result = ref<StockPage | null>(null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const filters = reactive({ q: '', productType: '', brandId: '', status: '', sort: 'name' as StockSort, page: 1 })

async function load() {
  error.value = null
  const query = {
    q: filters.q || undefined,
    productType: filters.productType || undefined,
    brandId: filters.brandId || undefined,
    status: filters.status || undefined,
    sort: filters.sort,
    page: filters.page,
    pageSize: PAGE_SIZE,
  }
  try {
    result.value = StockPage.parse(await session.adminFetch('/api/admin/stock', { query }))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function search() {
  filters.page = 1
  return load()
}

function goTo(page: number) {
  filters.page = page
  return load()
}

const lastPage = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / PAGE_SIZE)))
const attributesText = (item: StockItem) => Object.values(item.attributes).flat().join(' · ')

// Điều chỉnh: form giữ tồn lúc mở, để API từ chối khi tồn đã đổi trong lúc nhân viên đang đếm.

type AdjustmentForm = {
  item: StockItem
  expectedOnHand: number
  reason: StockAdjustmentReason
  amount: number | null
  note: string
}
const form = ref<AdjustmentForm | null>(null)
const formErrors = ref<FieldError[]>([])

function openAdjustment(item: StockItem) {
  form.value = { item, expectedOnHand: item.onHand, reason: 'stocktake', amount: null, note: '' }
  formErrors.value = []
  notice.value = null
}

const AMOUNT_LABELS = {
  count: 'Số đếm thực tế',
  decrease: 'Số lượng giảm',
  signed: 'Số tăng (dương) hoặc giảm (âm)',
} as const
const AMOUNT_MIN = { count: 0, decrease: 1, signed: undefined } as const

const inputMode = computed(() => ADJUSTMENT_INPUT[form.value?.reason ?? 'stocktake'].mode)

/** Tồn sau khi lưu, để nhân viên thấy trước kết quả; `null` khi chưa nhập số. */
const preview = computed(() => {
  const f = form.value
  if (!f || f.amount === null || Number.isNaN(f.amount)) return null
  return f.expectedOnHand + adjustmentDelta(f.reason, f.amount, f.expectedOnHand)
})

const errorAt = (path: string) => formErrors.value.find((f) => f.path === path)?.message

async function saveAdjustment() {
  const f = form.value
  if (!f) return
  const body = {
    variantId: f.item.variantId,
    reason: f.reason,
    expectedOnHand: f.expectedOnHand,
    note: f.note,
    [ADJUSTMENT_INPUT[f.reason].field]: f.amount,
  }
  try {
    const saved = StockItem.parse(await session.adminFetch('/api/admin/stock/adjustments', { method: 'POST', body }))
    notice.value = `Đã điều chỉnh ${saved.sku}: tồn hiện tại ${saved.onHand}`
    form.value = null
    await load()
  } catch (err) {
    formErrors.value = apiFieldErrors(err)
    error.value = apiErrorMessage(err)
    // Tồn đã đổi: form nhận số tồn mới và xóa số đã nhập, để nhân viên đếm lại thay vì gửi lại số cũ.
    const onHand = apiErrorDetails(err)?.onHand
    if (typeof onHand === 'number') {
      f.expectedOnHand = onHand
      f.amount = null
      await load()
    }
  }
}

brands.value = AdminBrandList.parse(await session.adminFetch('/api/admin/brands')).items
await load()
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Tồn kho</h1>
        <p class="admin-page-desc">
          Tồn của từng biến thể trong kho. Mọi thay đổi tồn đều ghi vào sổ xuất nhập; khách chỉ thấy còn hàng hay hết
          hàng, không thấy số lượng.
        </p>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>
    <div v-if="notice" class="admin-alert admin-alert-success" role="status">
      <span>{{ notice }}</span>
    </div>

    <!-- Form điều chỉnh -->
    <div v-if="form" class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <form @submit.prevent="saveAdjustment">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px">
          <div>
            <strong style="font-family: var(--adm-mono)">{{ form.item.sku }}</strong>
            <span style="color: var(--adm-muted)">
              · {{ form.item.product.name }} · {{ attributesText(form.item) }}</span
            >
          </div>
          <span style="font-size: 12px; color: var(--adm-muted)">
            Tồn lúc mở form: <strong>{{ form.expectedOnHand }}</strong>
          </span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px">
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label">Lý do</label>
            <select v-model="form.reason" class="form-select">
              <option v-for="r in StockAdjustmentReason.options" :key="r" :value="r">
                {{ STOCK_REASON_LABELS[r] }}
              </option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label">{{ AMOUNT_LABELS[inputMode] }}</label>
            <input
              v-model.number="form.amount"
              type="number"
              step="1"
              :min="AMOUNT_MIN[inputMode]"
              class="form-input"
              required
            />
            <small class="field-error-msg">{{ errorAt('countedQuantity') ?? errorAt('quantity') }}</small>
          </div>
          <div class="form-group" style="margin-bottom: 0; grid-column: span 2">
            <label class="form-label">Ghi chú{{ form.reason === 'other' ? ' *' : '' }}</label>
            <input v-model="form.note" class="form-input" :required="form.reason === 'other'" maxlength="1000" />
            <small class="field-error-msg">{{ errorAt('note') }}</small>
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center; margin-top: 12px">
          <button type="submit" class="btn btn-primary btn-sm">Lưu điều chỉnh</button>
          <button type="button" class="btn btn-secondary btn-sm" @click="form = null">Hủy</button>
          <span v-if="preview !== null" style="font-size: 12px; color: var(--adm-muted)">
            Tồn sau khi lưu: <strong :style="{ color: preview < 0 ? '#b91c1c' : undefined }">{{ preview }}</strong>
          </span>
        </div>
      </form>
    </div>

    <!-- Bộ lọc -->
    <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <form @submit.prevent="search">
        <div
          style="
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) 120px;
            gap: 12px;
            align-items: flex-end;
          "
        >
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" style="font-size: 12px">SKU hoặc tên sản phẩm</label>
            <input v-model="filters.q" class="form-input" style="font-size: 12px; padding: 5px 10px" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" style="font-size: 12px">Nhóm hàng</label>
            <select v-model="filters.productType" class="form-select" style="font-size: 12px; padding: 6px 10px">
              <option value="">-- Tất cả --</option>
              <option v-for="t in ProductType.options" :key="t" :value="t">{{ PRODUCT_TYPE_LABELS[t] }}</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" style="font-size: 12px">Thương hiệu</label>
            <select v-model="filters.brandId" class="form-select" style="font-size: 12px; padding: 6px 10px">
              <option value="">-- Tất cả --</option>
              <option v-for="b in brands" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" style="font-size: 12px">Trạng thái biến thể</label>
            <select v-model="filters.status" class="form-select" style="font-size: 12px; padding: 6px 10px">
              <option value="">-- Tất cả --</option>
              <option v-for="s in VariantStatus.options" :key="s" :value="s">{{ VARIANT_STATUS_LABELS[s] }}</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" style="font-size: 12px">Sắp xếp</label>
            <select v-model="filters.sort" class="form-select" style="font-size: 12px; padding: 6px 10px">
              <option v-for="s in StockSort.options" :key="s" :value="s">{{ SORT_LABELS[s] }}</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Lọc</button>
        </div>
      </form>
    </div>

    <!-- Bảng tồn -->
    <div class="admin-table-card">
      <div
        v-if="!result || result.items.length === 0"
        style="padding: 40px; text-align: center; color: var(--adm-muted)"
      >
        Không có biến thể nào phù hợp.
      </div>
      <div v-else>
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Sản phẩm</th>
                <th>Thuộc tính</th>
                <th>Trạng thái</th>
                <th class="admin-table-num">Tồn</th>
                <th style="text-align: right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in result.items" :key="item.variantId">
                <td style="font-family: var(--adm-mono); font-size: 12px; font-weight: 600">{{ item.sku }}</td>
                <td>
                  <NuxtLink :to="`/admin/products/${item.product.id}`" style="font-weight: 500">
                    {{ item.product.name }}
                  </NuxtLink>
                  <div style="font-size: 11px; color: var(--adm-muted)">
                    {{ item.brand.name }} · {{ PRODUCT_TYPE_LABELS[item.product.productType] }}
                  </div>
                </td>
                <td style="font-size: 12px">{{ attributesText(item) || '—' }}</td>
                <td>
                  <span :class="['badge', item.status === 'active' ? 'badge-published' : 'badge-archived']">
                    {{ VARIANT_STATUS_LABELS[item.status] }}
                  </span>
                </td>
                <td class="admin-table-num" style="font-weight: 600">{{ item.onHand }}</td>
                <td style="text-align: right; white-space: nowrap">
                  <NuxtLink :to="`/admin/stock/movements?variantId=${item.variantId}`" class="btn btn-secondary btn-sm">
                    Sổ
                  </NuxtLink>
                  <button
                    v-if="canAdjust"
                    type="button"
                    class="btn btn-secondary btn-sm"
                    style="margin-left: 6px"
                    @click="openAdjustment(item)"
                  >
                    Điều chỉnh
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            border-top: 1px solid var(--adm-border);
          "
        >
          <div style="font-size: 12px; color: var(--adm-muted)">
            Trang <strong>{{ filters.page }}</strong> / <strong>{{ lastPage }}</strong> ({{ result.total }} biến thể)
          </div>
          <div style="display: flex; gap: 8px">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="filters.page <= 1"
              @click="goTo(filters.page - 1)"
            >
              ‹ Trang trước
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="filters.page >= lastPage"
              @click="goTo(filters.page + 1)"
            >
              Trang sau ›
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
