<script setup lang="ts">
import { CollectionsReport } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'report.view' })

const session = useAdminSession()
// The "Cần đối soát" figure is a link only when the viewer can open the reconciliation page.
const reconciliationCard = session.canOpen('/admin/reconciliation') ? resolveComponent('NuxtLink') : 'div'
const period = useReportPeriod()
const report = ref<CollectionsReport | null>(null)
const error = ref<string | null>(null)

async function load() {
  error.value = null
  try {
    report.value = CollectionsReport.parse(
      await session.adminFetch('/api/admin/reports/collections', { query: period.value }),
    )
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

const COLUMNS = [
  { key: 'receivedFull', label: 'Trả đủ' },
  { key: 'receivedDeposit', label: 'Tiền cọc' },
  { key: 'receivedRemainder', label: 'Phần còn lại' },
  { key: 'received', label: 'Tiền vào', strong: true },
  { key: 'refundedCancellation', label: 'Hoàn do hủy' },
  { key: 'refundedReconciliation', label: 'Hoàn do đối soát' },
  { key: 'refundedReturn', label: 'Hoàn do trả hàng' },
  { key: 'refunded', label: 'Tiền ra', strong: true },
  { key: 'net', label: 'Tiền thu thuần', strong: true },
] as const

await load()
watch(period, load)
</script>

<template>
  <div>
    <ReportExportButton name="collections" slug="tien-thu" :query="period" />
    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <template v-if="report">
      <h2 class="admin-section-title">Tại thời điểm xem</h2>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Cọc đang giữ</div>
          <div class="stat-value" data-testid="collections-held">
            {{ formatVnd(report.snapshot.depositsHeld.amount) }}
          </div>
          <div class="stat-sub">
            {{ report.snapshot.depositsHeld.count }} đơn đặt trước chưa giao; gồm cả phần còn lại khách đã trả
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Còn phải thu</div>
          <div class="stat-value">{{ formatVnd(report.snapshot.outstanding.amount) }}</div>
          <div class="stat-sub">Phần còn lại của {{ report.snapshot.outstanding.count }} đơn đặt trước đã cọc</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Đang hoàn</div>
          <div class="stat-value">{{ formatVnd(report.snapshot.refunding.amount) }}</div>
          <div class="stat-sub">{{ report.snapshot.refunding.count }} khoản chờ thực hiện hoặc cổng đang xử lý</div>
        </div>
        <component
          :is="reconciliationCard"
          to="/admin/reconciliation"
          class="stat-card"
          style="text-decoration: none; color: inherit"
        >
          <div class="stat-label">Cần đối soát</div>
          <div class="stat-value">{{ formatVnd(report.snapshot.reconciliation.amount) }}</div>
          <div class="stat-sub">{{ report.snapshot.reconciliation.count }} mục đang mở</div>
        </component>
      </div>

      <h2 class="admin-section-title">Trong kỳ</h2>
      <p style="margin: -4px 0 12px; font-size: 12px; color: var(--adm-muted)">
        Tiền vào theo ngày cổng báo nhận tiền; tiền ra là các khoản hoàn đã xong, theo ngày xong. Khoản hoàn đang chờ
        chưa trừ.
      </p>
      <div class="admin-table-card">
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>{{ report.groupBy === 'day' ? 'Ngày' : 'Tháng' }}</th>
                <th v-for="col in COLUMNS" :key="col.key" class="admin-table-num">{{ col.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.rows" :key="row.period">
                <td style="font-family: var(--adm-mono); font-size: 12px">{{ formatReportPeriod(row.period) }}</td>
                <td
                  v-for="col in COLUMNS"
                  :key="col.key"
                  class="admin-table-num"
                  :style="'strong' in col ? 'font-weight: 600' : ''"
                >
                  {{ formatVnd(row[col.key]) }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr style="font-weight: 600">
                <td>Tổng</td>
                <td v-for="col in COLUMNS" :key="col.key" class="admin-table-num">
                  {{ formatVnd(report.total[col.key]) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
