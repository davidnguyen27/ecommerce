<script setup lang="ts">
import { ReturnsReport, type ProductType, type WarrantyReportOutcome } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'report.view' })

const session = useAdminSession()
const period = useReportPeriod()
const report = ref<ReturnsReport | null>(null)
const error = ref<string | null>(null)

async function load() {
  error.value = null
  const query = { from: period.value.from, to: period.value.to }
  try {
    report.value = ReturnsReport.parse(await session.adminFetch('/api/admin/reports/returns', { query }))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

const KIND_LABELS = { return: 'Trả hàng', exchange: 'Đổi hàng' } as const
const WARRANTY_LABELS: Record<WarrantyReportOutcome, string> = {
  ...WARRANTY_OUTCOME_LABELS,
  declined: 'Từ chối tiếp nhận',
  in_progress: 'Đang xử lý',
}

/**
 * Quantity table: one row per return reason (exchanges without a reason get their own row), one column per product
 * type.
 */
const pivot = computed(() => {
  const lines = report.value?.lines ?? []
  const types = [...new Set(lines.map((l) => l.productType))] as ProductType[]
  const rows = new Map<string, { label: string; cells: Map<ProductType, number>; total: number }>()
  for (const line of lines) {
    const key = line.kind === 'exchange' ? 'exchange' : (line.reason ?? 'none')
    const label = line.kind === 'exchange' ? 'Đổi hàng' : line.reason ? RETURN_REASON_LABELS[line.reason] : 'Không ghi'
    const row = rows.get(key) ?? { label, cells: new Map(), total: 0 }
    row.cells.set(line.productType, (row.cells.get(line.productType) ?? 0) + line.quantity)
    row.total += line.quantity
    rows.set(key, row)
  }
  return { types, rows: [...rows.entries()].map(([key, row]) => ({ key, ...row })) }
})

await load()
watch(period, load)
</script>

<template>
  <div>
    <ReportExportButton name="returns" slug="doi-tra" :query="period" />
    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <template v-if="report">
      <p style="margin: 0 0 12px; font-size: 12px; color: var(--adm-muted)">
        Tính các yêu cầu tạo trong kỳ. Nhóm hàng lấy theo sản phẩm hiện tại của dòng đơn.
      </p>
      <div class="report-grid">
        <section class="admin-table-card">
          <h2 class="admin-section-title" style="padding: 14px 18px 0">Yêu cầu trả và đổi</h2>
          <table class="admin-table">
            <thead>
              <tr>
                <th>Loại</th>
                <th class="admin-table-num">Chấp nhận</th>
                <th class="admin-table-num">Từ chối</th>
                <th class="admin-table-num">Chưa quyết</th>
                <th class="admin-table-num">Tổng</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.requests" :key="row.kind">
                <td>{{ KIND_LABELS[row.kind] }}</td>
                <td class="admin-table-num">{{ row.accepted }}</td>
                <td class="admin-table-num">{{ row.rejected }}</td>
                <td class="admin-table-num">{{ row.pending }}</td>
                <td class="admin-table-num" style="font-weight: 600">{{ row.total }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="admin-table-card">
          <h2 class="admin-section-title" style="padding: 14px 18px 0">Bảo hành</h2>
          <table class="admin-table">
            <thead>
              <tr>
                <th>Kết quả</th>
                <th class="admin-table-num">Số yêu cầu</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.warranty" :key="row.outcome">
                <td>{{ WARRANTY_LABELS[row.outcome] }}</td>
                <td class="admin-table-num">{{ row.count }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr style="font-weight: 600">
                <td>Tổng</td>
                <td class="admin-table-num">{{ report.warrantyTotal }}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <section class="admin-table-card">
          <h2 class="admin-section-title" style="padding: 14px 18px 0">Số lượng theo lý do</h2>
          <div v-if="!pivot.rows.length" style="padding: 24px; text-align: center; color: var(--adm-muted)">
            Không có yêu cầu trả hay đổi nào.
          </div>
          <div v-else style="overflow-x: auto">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Lý do</th>
                  <th v-for="type in pivot.types" :key="type" class="admin-table-num">
                    {{ PRODUCT_TYPE_LABELS[type] }}
                  </th>
                  <th class="admin-table-num">Tổng</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in pivot.rows" :key="row.key">
                  <td>{{ row.label }}</td>
                  <td v-for="type in pivot.types" :key="type" class="admin-table-num">
                    {{ row.cells.get(type) ?? 0 }}
                  </td>
                  <td class="admin-table-num" style="font-weight: 600">{{ row.total }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="admin-table-card">
          <h2 class="admin-section-title" style="padding: 14px 18px 0">Tỷ lệ trả theo nhóm hàng</h2>
          <p style="margin: 4px 18px 8px; font-size: 12px; color: var(--adm-muted)">
            Số cái của yêu cầu trả đã chấp nhận trong kỳ chia cho số cái đã giao trong kỳ. Hai số không cùng tập đơn:
            hàng trả trong kỳ có thể đã giao từ kỳ trước.
          </p>
          <div v-if="!report.returnRate.length" style="padding: 24px; text-align: center; color: var(--adm-muted)">
            Không có hàng giao hay trả trong kỳ.
          </div>
          <table v-else class="admin-table">
            <thead>
              <tr>
                <th>Nhóm hàng</th>
                <th class="admin-table-num">Trả</th>
                <th class="admin-table-num">Đã giao</th>
                <th class="admin-table-num">Tỷ lệ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.returnRate" :key="row.productType">
                <td>{{ PRODUCT_TYPE_LABELS[row.productType] }}</td>
                <td class="admin-table-num">{{ row.returned }}</td>
                <td class="admin-table-num">{{ row.delivered }}</td>
                <td class="admin-table-num" style="font-weight: 600">{{ formatReportRate(row.rate) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.report-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
  gap: 16px;
  align-items: start;
}
</style>
