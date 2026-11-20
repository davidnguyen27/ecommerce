<script setup lang="ts">
import { REVENUE_TOP_SKUS, RevenueReport } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'report.view' })

const session = useAdminSession()
const period = useReportPeriod()
const report = ref<RevenueReport | null>(null)
const error = ref<string | null>(null)

async function load() {
  error.value = null
  try {
    report.value = RevenueReport.parse(await session.adminFetch('/api/admin/reports/revenue', { query: period.value }))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

type BreakdownRow = { key: string; label: string; sub?: string; quantity: number; gross: number }

const breakdown = computed(() => {
  const r = report.value
  if (!r) return []
  return [
    {
      title: 'Theo nhóm hàng',
      column: 'Nhóm hàng',
      rows: r.byProductType.map<BreakdownRow>((row) => ({
        key: row.productType,
        label: PRODUCT_TYPE_LABELS[row.productType],
        ...row,
      })),
    },
    {
      title: 'Theo thương hiệu',
      column: 'Thương hiệu',
      rows: r.byBrand.map<BreakdownRow>((row) => ({ key: row.brandId, label: row.brandName, ...row })),
    },
    {
      title: `Top ${REVENUE_TOP_SKUS} SKU`,
      column: 'SKU',
      rows: r.topSkus.map<BreakdownRow>((row) => ({
        key: row.variantId,
        label: row.sku,
        sub: row.productName,
        ...row,
      })),
    },
  ]
})

await load()
watch(period, load)
</script>

<template>
  <div>
    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <template v-if="report">
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Doanh thu thuần</div>
          <div class="stat-value" data-testid="revenue-net">{{ formatVnd(report.total.net) }}</div>
          <div class="stat-sub">
            Gộp {{ formatVnd(report.total.gross) }} − trả lại {{ formatVnd(report.total.returns) }}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Đơn đã giao</div>
          <div class="stat-value">{{ report.total.deliveredOrders }}</div>
          <div class="stat-sub">
            Hàng sẵn {{ formatVnd(report.total.grossStandard) }} · đặt trước {{ formatVnd(report.total.grossPreorder) }}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Phí giao</div>
          <div class="stat-value">{{ formatVnd(report.total.shippingFees) }}</div>
          <div class="stat-sub">Của các đơn đã giao; không tính vào doanh thu</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Mất cọc</div>
          <div class="stat-value">{{ formatVnd(report.total.forfeitedDeposits) }}</div>
          <div class="stat-sub">Đơn đặt trước bị hủy trong kỳ; không tính vào doanh thu</div>
        </div>
      </div>

      <div class="admin-table-card">
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>{{ report.groupBy === 'day' ? 'Ngày' : 'Tháng' }}</th>
                <th class="admin-table-num">Đơn đã giao</th>
                <th class="admin-table-num">Hàng sẵn</th>
                <th class="admin-table-num">Đặt trước</th>
                <th class="admin-table-num">Doanh thu gộp</th>
                <th class="admin-table-num">Hàng trả lại</th>
                <th class="admin-table-num">Doanh thu thuần</th>
                <th class="admin-table-num">Phí giao</th>
                <th class="admin-table-num">Mất cọc</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.rows" :key="row.period">
                <td style="font-family: var(--adm-mono); font-size: 12px">{{ formatReportPeriod(row.period) }}</td>
                <td class="admin-table-num">{{ row.deliveredOrders }}</td>
                <td class="admin-table-num">{{ formatVnd(row.grossStandard) }}</td>
                <td class="admin-table-num">{{ formatVnd(row.grossPreorder) }}</td>
                <td class="admin-table-num">{{ formatVnd(row.gross) }}</td>
                <td class="admin-table-num">{{ formatVnd(row.returns) }}</td>
                <td class="admin-table-num" style="font-weight: 600">{{ formatVnd(row.net) }}</td>
                <td class="admin-table-num">{{ formatVnd(row.shippingFees) }}</td>
                <td class="admin-table-num">{{ formatVnd(row.forfeitedDeposits) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr style="font-weight: 600">
                <td>Tổng</td>
                <td class="admin-table-num">{{ report.total.deliveredOrders }}</td>
                <td class="admin-table-num">{{ formatVnd(report.total.grossStandard) }}</td>
                <td class="admin-table-num">{{ formatVnd(report.total.grossPreorder) }}</td>
                <td class="admin-table-num">{{ formatVnd(report.total.gross) }}</td>
                <td class="admin-table-num">{{ formatVnd(report.total.returns) }}</td>
                <td class="admin-table-num">{{ formatVnd(report.total.net) }}</td>
                <td class="admin-table-num">{{ formatVnd(report.total.shippingFees) }}</td>
                <td class="admin-table-num">{{ formatVnd(report.total.forfeitedDeposits) }}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p style="margin: 24px 0 12px; font-size: 12px; color: var(--adm-muted)">
        Ba bảng dưới tính doanh thu gộp của các đơn đã giao trong kỳ, chưa trừ hàng trả lại. Nhóm hàng, thương hiệu và
        tên lấy theo sản phẩm hiện tại.
      </p>
      <div class="report-breakdown">
        <section v-for="table in breakdown" :key="table.title" class="admin-table-card">
          <h2 class="admin-section-title" style="padding: 14px 18px 0">{{ table.title }}</h2>
          <div v-if="!table.rows.length" style="padding: 24px; text-align: center; color: var(--adm-muted)">
            Chưa có đơn nào được giao trong kỳ.
          </div>
          <div v-else style="overflow-x: auto">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>{{ table.column }}</th>
                  <th class="admin-table-num">Số lượng</th>
                  <th class="admin-table-num">Doanh thu gộp</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in table.rows" :key="row.key">
                  <td>
                    <span :style="row.sub ? 'font-family: var(--adm-mono); font-size: 12px; font-weight: 600' : ''">{{
                      row.label
                    }}</span>
                    <div v-if="row.sub" style="font-size: 11px; color: var(--adm-muted)">{{ row.sub }}</div>
                  </td>
                  <td class="admin-table-num">{{ row.quantity }}</td>
                  <td class="admin-table-num">{{ formatVnd(row.gross) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.report-breakdown {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
  gap: 16px;
  align-items: start;
}
</style>
