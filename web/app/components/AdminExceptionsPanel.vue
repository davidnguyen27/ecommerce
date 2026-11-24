<script setup lang="ts">
import { ExceptionsReport } from '@ecommerce/shared'

// Exceptions board (spec M7) for `report.view` holders: pending decisions, each linking to where it is handled.
const session = useAdminSession()
const canOpen = session.canOpen
const report = ref<ExceptionsReport | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    report.value = ExceptionsReport.parse(await session.adminFetch('/api/admin/reports/exceptions'))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
})

type Row = { key: string; to: string | null; title: string; detail: string }
type Section = { key: string; title: string; hint: string; to: string | null; count: number; rows: Row[] }

/** Link to the order page when the viewer can open it. */
const orderLink = (code: number) => (canOpen('/admin/orders') ? `/admin/orders/${code}` : null)

const sections = computed<Section[]>(() => {
  const r = report.value
  if (!r) return []
  return [
    {
      key: 'reconciliation',
      title: 'Cần đối soát',
      hint: 'Khoản tiền về không khớp đơn',
      to: canOpen('/admin/reconciliation') ? '/admin/reconciliation' : null,
      count: r.reconciliation.count,
      rows: r.reconciliation.items.map((i) => ({
        key: i.id,
        to: orderLink(i.orderCode),
        title: `#${i.orderCode} · ${formatVnd(i.amount)}`,
        detail: `${RECONCILIATION_REASON_LABELS[i.reason]} · ${formatDateTime(i.receivedAt)}`,
      })),
    },
    {
      key: 'stale-refunds',
      title: 'Hoàn tiền treo',
      hint: `Chưa xong sau ${r.thresholds.staleRefundDays} ngày`,
      to: null,
      count: r.staleRefunds.count,
      rows: r.staleRefunds.items.map((i) => ({
        key: i.id,
        to: orderLink(i.orderCode),
        title: `#${i.orderCode} · ${formatVnd(i.amount)}`,
        detail: `${REFUND_STATUS_LABELS[i.status]} · tạo ${formatDate(i.createdAt)}`,
      })),
    },
    {
      key: 'overdue-remainders',
      title: 'Quá hạn phần còn lại',
      hint: 'Đơn đặt trước chưa trả phần còn lại',
      to: canOpen('/admin/preorders/attention') ? '/admin/preorders/attention' : null,
      count: r.overdueRemainders.count,
      rows: r.overdueRemainders.items.map((i) => ({
        key: String(i.orderCode),
        to: orderLink(i.orderCode),
        title: `#${i.orderCode} · còn ${formatVnd(i.remainingAmount)}`,
        detail: `Hạn ${formatDate(i.remainderDueAt)}`,
      })),
    },
    {
      key: 'late-preorders',
      title: 'Đặt trước trễ hẹn',
      hint: 'Đã quá ngày giao dự kiến cuối, chưa giao',
      to: null,
      count: r.latePreorders.count,
      rows: r.latePreorders.items.map((i) => ({
        key: String(i.orderCode),
        to: orderLink(i.orderCode),
        title: `#${i.orderCode} · ${i.productName}`,
        detail: `Hẹn giao trước ${formatDateOnly(i.deliveryTo)}`,
      })),
    },
    {
      key: 'unassigned-support',
      title: 'Yêu cầu chưa ai nhận',
      hint: 'Yêu cầu hỗ trợ chưa có người phụ trách',
      to: canOpen('/admin/support') ? '/admin/support?unassigned=true' : null,
      count: r.unassignedSupport.count,
      rows: r.unassignedSupport.items.map((i) => ({
        key: String(i.code),
        to: canOpen('/admin/support') ? `/admin/support/${i.code}` : null,
        title: `#YC${i.code} · ${i.subject}`,
        detail: `${SUPPORT_KIND_LABELS[i.kind]} · ${formatDateTime(i.createdAt)}`,
      })),
    },
    {
      key: 'low-stock',
      title: 'Sắp hết hàng',
      hint: `Còn bán được ${r.thresholds.lowStock} cái trở xuống`,
      to: canOpen('/admin/stock') ? '/admin/stock' : null,
      count: r.lowStock.count,
      rows: r.lowStock.items.map((i) => ({
        key: i.variantId,
        to: canOpen('/admin/stock/movements') ? `/admin/stock/movements?variantId=${i.variantId}` : null,
        title: `${i.sku} · còn ${i.available}`,
        detail: i.productName,
      })),
    },
  ]
})
</script>

<template>
  <section style="margin-bottom: 24px" aria-labelledby="exceptions-title">
    <h2 id="exceptions-title" class="admin-section-title">Cần xử lý</h2>
    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>
    <div v-else-if="!report" style="font-size: 13px; color: var(--adm-muted)">Đang tải…</div>
    <div v-else class="exceptions-grid">
      <article v-for="section in sections" :key="section.key" class="admin-table-card exceptions-card">
        <header class="exceptions-head">
          <div>
            <NuxtLink v-if="section.to" :to="section.to" class="exceptions-title">{{ section.title }}</NuxtLink>
            <span v-else class="exceptions-title">{{ section.title }}</span>
            <div class="exceptions-hint">{{ section.hint }}</div>
          </div>
          <span
            class="exceptions-count"
            :class="{ 'exceptions-count-zero': section.count === 0 }"
            :data-testid="`exceptions-${section.key}`"
            >{{ section.count }}</span
          >
        </header>
        <div v-if="!section.rows.length" class="exceptions-empty">Không có việc nào.</div>
        <ul v-else class="exceptions-list">
          <li v-for="row in section.rows" :key="row.key">
            <NuxtLink v-if="row.to" :to="row.to">{{ row.title }}</NuxtLink>
            <span v-else>{{ row.title }}</span>
            <div class="exceptions-hint">{{ row.detail }}</div>
          </li>
        </ul>
        <div v-if="section.count > section.rows.length" class="exceptions-more">
          và {{ section.count - section.rows.length }} việc khác
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.exceptions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 16px;
  align-items: start;
}
.exceptions-card {
  padding: 14px 18px;
}
.exceptions-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
.exceptions-title {
  font-weight: 600;
  font-size: 14px;
  color: inherit;
}
.exceptions-hint {
  font-size: 11px;
  color: var(--adm-muted);
}
.exceptions-count {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
}
.exceptions-count-zero {
  color: var(--adm-muted);
  font-weight: 500;
}
.exceptions-empty {
  margin-top: 10px;
  font-size: 12px;
  color: var(--adm-muted);
}
.exceptions-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  font-size: 13px;
}
.exceptions-list li {
  padding: 6px 0;
  border-top: 1px solid var(--adm-border);
}
.exceptions-more {
  margin-top: 6px;
  font-size: 12px;
  color: var(--adm-muted);
}
</style>
