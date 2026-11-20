<script setup lang="ts">
import { ProductType, StockReport } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'report.view' })

const session = useAdminSession()
const canOpen = session.canOpen
const period = useReportPeriod()
const report = ref<StockReport | null>(null)
const error = ref<string | null>(null)
const filters = reactive({ productType: '', brandId: '', movedOnly: false, page: 1 })

async function load() {
  error.value = null
  const query = {
    from: period.value.from,
    to: period.value.to,
    productType: filters.productType || undefined,
    brandId: filters.brandId || undefined,
    movedOnly: filters.movedOnly ? 'true' : undefined,
    page: filters.page,
  }
  try {
    report.value = StockReport.parse(await session.adminFetch('/api/admin/reports/stock', { query }))
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

const lastPage = computed(() => Math.max(1, Math.ceil((report.value?.total ?? 0) / (report.value?.pageSize ?? 1))))

const COLUMNS = [
  { key: 'opening', label: 'Tồn đầu' },
  { key: 'received', label: 'Nhập' },
  { key: 'sold', label: 'Xuất bán' },
  { key: 'returned', label: 'Hàng hoàn về' },
  { key: 'adjustedUp', label: 'Điều chỉnh tăng' },
  { key: 'adjustedDown', label: 'Điều chỉnh giảm' },
  { key: 'closing', label: 'Tồn cuối' },
] as const

await load()
watch(period, search)
</script>

<template>
  <div>
    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
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
            <label class="form-label" for="stock-report-type" style="font-size: 12px">Nhóm hàng</label>
            <select id="stock-report-type" v-model="filters.productType" class="form-select">
              <option value="">-- Tất cả --</option>
              <option v-for="t in ProductType.options" :key="t" :value="t">{{ PRODUCT_TYPE_LABELS[t] }}</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="stock-report-brand" style="font-size: 12px">Thương hiệu</label>
            <select id="stock-report-brand" v-model="filters.brandId" class="form-select">
              <option value="">-- Tất cả --</option>
              <option v-for="b in report?.brands ?? []" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
          </div>
          <label style="display: flex; gap: 8px; align-items: center; font-size: 13px; padding-bottom: 8px">
            <input v-model="filters.movedOnly" type="checkbox" />
            Chỉ biến thể có biến động
          </label>
          <button type="submit" class="btn btn-primary btn-sm">Lọc</button>
        </div>
      </form>
    </div>

    <p style="margin: 0 0 12px; font-size: 12px; color: var(--adm-muted)">
      Tồn đầu và tồn cuối là tồn lúc bắt đầu và kết thúc kỳ. Nhập gồm phiếu nhập và tồn đầu kỳ khi bắt đầu dùng hệ
      thống; xuất bán gồm cả hàng đổi giao đi. Chỉ có số lượng, chưa có giá trị tồn.
    </p>

    <div v-if="report" class="admin-table-card">
      <div v-if="!report.items.length" style="padding: 40px; text-align: center; color: var(--adm-muted)">
        Không có biến thể nào phù hợp.
      </div>
      <template v-else>
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th v-for="col in COLUMNS" :key="col.key" class="admin-table-num">{{ col.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in report.items" :key="item.variantId">
                <td>
                  <NuxtLink
                    v-if="canOpen('/admin/stock/movements')"
                    :to="`/admin/stock/movements?variantId=${item.variantId}`"
                    style="font-family: var(--adm-mono); font-size: 12px; font-weight: 600"
                    >{{ item.sku }}</NuxtLink
                  >
                  <span v-else style="font-family: var(--adm-mono); font-size: 12px; font-weight: 600">{{
                    item.sku
                  }}</span>
                  <div style="font-size: 11px; color: var(--adm-muted)">
                    {{ item.productName }} · {{ item.brandName }}
                  </div>
                </td>
                <td
                  v-for="col in COLUMNS"
                  :key="col.key"
                  class="admin-table-num"
                  :style="col.key === 'closing' ? 'font-weight: 600' : ''"
                >
                  {{ item[col.key] }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr style="font-weight: 600">
                <td>Tổng ({{ report.total }} biến thể)</td>
                <td v-for="col in COLUMNS" :key="col.key" class="admin-table-num">{{ report.totals[col.key] }}</td>
              </tr>
            </tfoot>
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
            Trang <strong>{{ filters.page }}</strong> / <strong>{{ lastPage }}</strong>
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
      </template>
    </div>
  </div>
</template>
