<script setup lang="ts">
import { CancellationReport } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'report.view' })

const session = useAdminSession()
const period = useReportPeriod()
const report = ref<CancellationReport | null>(null)
const error = ref<string | null>(null)

async function load() {
  error.value = null
  const query = { from: period.value.from, to: period.value.to }
  try {
    report.value = CancellationReport.parse(await session.adminFetch('/api/admin/reports/cancellations', { query }))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

const percent = (rate: number | null) =>
  rate === null ? '—' : `${(rate * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`

await load()
watch(period, load)
</script>

<template>
  <div>
    <ReportExportButton name="cancellations" slug="huy-hoan-tien" :query="period" />
    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <template v-if="report">
      <p style="margin: 0 0 12px; font-size: 12px; color: var(--adm-muted)">
        Tính các đơn tạo trong kỳ. Đơn đã xác nhận là đơn đã từng nhận tiền (trả đủ hoặc đã cọc); tỷ lệ hủy chỉ tính
        trên các đơn này. Đơn bỏ dở là đơn bị hủy khi chưa nhận đồng nào, không tính vào tỷ lệ hủy.
      </p>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Tỷ lệ hủy</div>
          <div class="stat-value" data-testid="cancellation-rate">{{ percent(report.rate.total) }}</div>
          <div class="stat-sub">
            Hàng sẵn {{ percent(report.rate.standard) }} · đặt trước {{ percent(report.rate.preorder) }}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Đơn đã xác nhận</div>
          <div class="stat-value">{{ report.confirmed.total }}</div>
          <div class="stat-sub">
            Hàng sẵn {{ report.confirmed.standard }} · đặt trước {{ report.confirmed.preorder }}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Bị hủy khi đã nhận tiền</div>
          <div class="stat-value">{{ report.cancelled.total }}</div>
          <div class="stat-sub">
            Hàng sẵn {{ report.cancelled.standard }} · đặt trước {{ report.cancelled.preorder }}
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Đơn bỏ dở</div>
          <div class="stat-value">{{ report.abandonedTotal }}</div>
          <div class="stat-sub">Hủy khi chưa trả; không tính vào tỷ lệ hủy</div>
        </div>
      </div>

      <div class="report-grid">
        <section class="admin-table-card">
          <h2 class="admin-section-title" style="padding: 14px 18px 0">Hủy theo lý do</h2>
          <div style="overflow-x: auto">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Lý do</th>
                  <th class="admin-table-num">Hàng sẵn</th>
                  <th class="admin-table-num">Đặt trước</th>
                  <th class="admin-table-num">Tổng</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in report.byCause" :key="row.cause">
                  <td>{{ CANCEL_CAUSE_LABELS[row.cause] }}</td>
                  <td class="admin-table-num">{{ row.standard }}</td>
                  <td class="admin-table-num">{{ row.preorder }}</td>
                  <td class="admin-table-num">{{ row.total }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr style="font-weight: 600">
                  <td>Tổng</td>
                  <td class="admin-table-num">{{ report.cancelled.standard }}</td>
                  <td class="admin-table-num">{{ report.cancelled.preorder }}</td>
                  <td class="admin-table-num">{{ report.cancelled.total }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        <section class="admin-table-card">
          <h2 class="admin-section-title" style="padding: 14px 18px 0">Đơn bỏ dở</h2>
          <table class="admin-table">
            <thead>
              <tr>
                <th>Lý do</th>
                <th class="admin-table-num">Số đơn</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.abandoned" :key="row.reason">
                <td>{{ CANCEL_REASON_LABELS[row.reason] }}</td>
                <td class="admin-table-num">{{ row.count }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="admin-table-card">
          <h2 class="admin-section-title" style="padding: 14px 18px 0">Hoàn tiền tạo trong kỳ</h2>
          <div v-if="!report.refunds.length" style="padding: 24px; text-align: center; color: var(--adm-muted)">
            Không có khoản hoàn nào.
          </div>
          <div v-else style="overflow-x: auto">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Nguồn</th>
                  <th>Trạng thái</th>
                  <th class="admin-table-num">Số khoản</th>
                  <th class="admin-table-num">Số tiền</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in report.refunds" :key="`${row.origin}-${row.status}`">
                  <td>{{ REFUND_ORIGIN_LABELS[row.origin] }}</td>
                  <td>{{ REFUND_STATUS_LABELS[row.status] }}</td>
                  <td class="admin-table-num">{{ row.count }}</td>
                  <td class="admin-table-num">{{ formatVnd(row.amount) }}</td>
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
.report-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
  gap: 16px;
  align-items: start;
}
</style>
