<script setup lang="ts">
import { StockMovementKind, StockMovementPage } from '@ecommerce/shared'

definePageMeta({
  layout: 'admin',
  middleware: 'admin-auth',
  permission: ['catalog.edit', 'price.edit', 'stock.adjust'],
})

const PAGE_SIZE = 50

const session = useAdminSession()
const route = useRoute()
const result = ref<StockMovementPage | null>(null)
const error = ref<string | null>(null)
// `?variantId=` đến từ trang tồn hoặc trang soạn sản phẩm. Ngày hiểu theo giờ của trình duyệt; `to` tính hết ngày đã chọn.
const filters = reactive({
  variantId: typeof route.query.variantId === 'string' ? route.query.variantId : '',
  kind: '',
  from: '',
  to: '',
  page: 1,
})

function startOfDay(date: string, addDays = 0) {
  const day = new Date(`${date}T00:00:00`)
  day.setDate(day.getDate() + addDays)
  return day.toISOString()
}

async function load() {
  error.value = null
  const query = {
    variantId: filters.variantId || undefined,
    kind: filters.kind || undefined,
    from: filters.from ? startOfDay(filters.from) : undefined,
    to: filters.to ? startOfDay(filters.to, 1) : undefined,
    page: filters.page,
    pageSize: PAGE_SIZE,
  }
  try {
    result.value = StockMovementPage.parse(await session.adminFetch('/api/admin/stock/movements', { query }))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function search() {
  filters.page = 1
  return load()
}

function showAllVariants() {
  filters.variantId = ''
  return search()
}

function goTo(page: number) {
  filters.page = page
  return load()
}

const lastPage = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / PAGE_SIZE)))
/** SKU đang lọc, lấy từ dòng sổ đầu tiên; chưa có dòng nào thì không biết SKU. */
const filteredSku = computed(() => (filters.variantId ? result.value?.items[0]?.variant.sku : undefined))

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

await load()
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Sổ xuất nhập</h1>
        <p class="admin-page-desc">
          Mọi lần tồn thay đổi, mới nhất trước. Sổ chỉ ghi thêm, không sửa hay xóa được; ghi sai thì làm một điều chỉnh.
        </p>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <div v-if="filters.variantId" style="margin-bottom: 12px; font-size: 13px">
        Đang xem biến thể <strong style="font-family: var(--adm-mono)">{{ filteredSku ?? 'đã chọn' }}</strong>
        <button type="button" class="btn btn-secondary btn-sm" style="margin-left: 8px" @click="showAllVariants">
          Xem mọi biến thể
        </button>
      </div>
      <form @submit.prevent="search">
        <div
          style="
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)) 120px;
            gap: 12px;
            align-items: flex-end;
          "
        >
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" style="font-size: 12px">Loại biến động</label>
            <select v-model="filters.kind" class="form-select" style="font-size: 12px; padding: 6px 10px">
              <option value="">-- Tất cả --</option>
              <option v-for="k in StockMovementKind.options" :key="k" :value="k">{{ STOCK_KIND_LABELS[k] }}</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" style="font-size: 12px">Từ ngày</label>
            <input v-model="filters.from" type="date" class="form-input" style="font-size: 12px; padding: 5px 10px" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" style="font-size: 12px">Đến ngày</label>
            <input v-model="filters.to" type="date" class="form-input" style="font-size: 12px; padding: 5px 10px" />
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Lọc</button>
        </div>
      </form>
    </div>

    <div class="admin-table-card">
      <div
        v-if="!result || result.items.length === 0"
        style="padding: 40px; text-align: center; color: var(--adm-muted)"
      >
        Chưa có biến động nào phù hợp.
      </div>
      <div v-else>
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Thời điểm</th>
                <th>SKU</th>
                <th>Loại</th>
                <th class="admin-table-num">Thay đổi</th>
                <th class="admin-table-num">Tồn sau</th>
                <th>Ghi chú</th>
                <th>Người thực hiện</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in result.items" :key="m.id">
                <td style="font-family: var(--adm-mono); font-size: 11px; color: var(--adm-muted); white-space: nowrap">
                  {{ formatTime(m.createdAt) }}
                </td>
                <td>
                  <span style="font-family: var(--adm-mono); font-size: 12px; font-weight: 600">{{
                    m.variant.sku
                  }}</span>
                  <div style="font-size: 11px; color: var(--adm-muted)">{{ m.product.name }}</div>
                </td>
                <td>
                  {{ STOCK_KIND_LABELS[m.kind] }}
                  <span v-if="m.reason" style="color: var(--adm-muted)"> · {{ STOCK_REASON_LABELS[m.reason] }}</span>
                </td>
                <td class="admin-table-num" :style="{ fontWeight: 600, color: m.quantity < 0 ? '#b91c1c' : '#15803d' }">
                  {{ signed(m.quantity) }}
                </td>
                <td class="admin-table-num">{{ m.onHandAfter }}</td>
                <td style="font-size: 12px">{{ m.note || '—' }}</td>
                <td style="font-size: 12px">{{ m.actor.name }}</td>
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
            Trang <strong>{{ filters.page }}</strong> / <strong>{{ lastPage }}</strong> ({{ result.total }} dòng)
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
