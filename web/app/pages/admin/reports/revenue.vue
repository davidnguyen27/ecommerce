<script setup lang="ts">
import { RevenueReport } from '@ecommerce/shared'

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
    </template>
  </div>
</template>
