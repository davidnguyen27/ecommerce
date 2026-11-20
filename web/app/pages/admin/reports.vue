<script setup lang="ts">
import { ReportQuery } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'report.view' })

// Tab chưa làm hiện "Sắp có" cho tới khi ticket của nó xong (M7).
const TABS = [
  { to: '/admin/reports/revenue', label: 'Doanh thu', ready: true },
  { to: '/admin/reports/collections', label: 'Tiền thu', ready: true },
  { to: '/admin/reports/stock', label: 'Xuất nhập tồn', ready: false },
  { to: '/admin/reports/vouchers', label: 'Mã giảm giá', ready: false },
  { to: '/admin/reports/cancellations', label: 'Hủy & hoàn tiền', ready: false },
  { to: '/admin/reports/returns', label: 'Đổi trả', ready: false },
]

const route = useRoute()
const router = useRouter()
const period = useReportPeriod()
const form = reactive({ ...period.value })
const error = ref<string | null>(null)
watch(period, (value) => Object.assign(form, value))

function apply() {
  const parsed = ReportQuery.safeParse(form)
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? 'Kỳ báo cáo không hợp lệ'
    return
  }
  error.value = null
  return router.replace({ query: { ...route.query, ...parsed.data } })
}
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Báo cáo</h1>
        <p class="admin-page-desc">
          Ngày tính theo giờ Việt Nam. Doanh thu ghi theo ngày giao tới khách; tiền thu ghi theo ngày nhận tiền.
        </p>
      </div>
    </div>

    <nav class="report-tabs" aria-label="Các báo cáo">
      <template v-for="tab in TABS" :key="tab.to">
        <NuxtLink v-if="tab.ready" :to="{ path: tab.to, query: route.query }" class="report-tab">{{
          tab.label
        }}</NuxtLink>
        <span v-else class="report-tab report-tab-soon" aria-disabled="true">{{ tab.label }} · Sắp có</span>
      </template>
    </nav>

    <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <form @submit.prevent="apply">
        <div
          style="
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)) 120px;
            gap: 12px;
            align-items: flex-end;
          "
        >
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="report-from" style="font-size: 12px">Từ ngày</label>
            <input id="report-from" v-model="form.from" type="date" required class="form-input" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="report-to" style="font-size: 12px">Đến ngày</label>
            <input id="report-to" v-model="form.to" type="date" required class="form-input" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="report-group" style="font-size: 12px">Nhóm theo</label>
            <select id="report-group" v-model="form.groupBy" class="form-select">
              <option value="day">Ngày</option>
              <option value="month">Tháng</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Xem</button>
        </div>
      </form>
      <div v-if="error" class="admin-alert admin-alert-danger" role="alert" style="margin: 12px 0 0">
        <span>{{ error }}</span>
      </div>
    </div>

    <NuxtPage />
  </div>
</template>

<style scoped>
.report-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--adm-border);
}
.report-tab {
  padding: 8px 14px;
  font-size: 13px;
  color: var(--adm-muted);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  text-decoration: none;
}
.report-tab.router-link-active {
  color: inherit;
  font-weight: 600;
  border-bottom-color: currentColor;
}
.report-tab-soon {
  opacity: 0.6;
  cursor: default;
}
</style>
