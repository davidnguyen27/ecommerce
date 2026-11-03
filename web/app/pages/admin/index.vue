<script setup lang="ts">
import { AdminBrandList, AdminOrderPage, AdminProductList, AuditPage, ReconciliationPage } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const session = useAdminSession()
const canCatalog = session.can('catalog.edit')
const canPrice = session.can('price.edit')
const canAudit = session.can('audit.view')
const canSeeProducts = canCatalog || canPrice

// Lối tắt và số đếm lấy quyền từ menu nên chỉ hiện trang người dùng mở được.
const canOpen = (to: string) => {
  const permission = ADMIN_MENU_ITEMS.find((item) => item.to === to)?.permission
  return !permission || session.can(permission)
}

const SHORTCUTS = [
  { to: '/admin/products', label: 'Sản phẩm & Biến thể' },
  { to: '/admin/brands', label: 'Quản lý Thương hiệu & Logo' },
  { to: '/admin/categories', label: 'Cây Danh mục 5 Nhóm hàng' },
  { to: '/admin/pages', label: 'Soạn Chính sách Đổi trả / Bảo hành' },
]
const shortcuts = SHORTCUTS.filter((shortcut) => canOpen(shortcut.to))

// Mặc định của hai danh sách là hàng chờ soạn và mục còn mở, nên số đếm là `total` với `pageSize` 1 và link không cần query.
const ORDER_COUNTS = [
  {
    to: '/admin/orders',
    label: 'Đơn chờ soạn',
    sub: 'Đã trả đủ, chưa chuẩn bị hàng',
    testid: 'dashboard-to-pick',
    load: async () =>
      AdminOrderPage.parse(await session.adminFetch('/api/admin/orders', { query: { pageSize: 1 } })).total,
  },
  {
    to: '/admin/reconciliation',
    label: 'Cần đối soát',
    sub: 'Khoản tiền chưa xử lý',
    testid: 'dashboard-reconciliation',
    load: async () =>
      ReconciliationPage.parse(await session.adminFetch('/api/admin/reconciliation', { query: { pageSize: 1 } })).total,
  },
].filter((item) => canOpen(item.to))
const orderCounts = ref<Record<string, number>>({})

const stats = reactive({
  publishedCount: 0,
  draftCount: 0,
  archivedCount: 0,
  brandCount: 0,
  recentProducts: [] as AdminProductList['items'],
  recentAudits: [] as AuditPage['items'],
})

const loading = ref(true)

onMounted(async () => {
  try {
    const counts = await Promise.all(ORDER_COUNTS.map(async (item) => [item.to, await item.load()] as const))
    orderCounts.value = Object.fromEntries(counts)

    if (canSeeProducts) {
      const prodRes = AdminProductList.parse(await session.adminFetch('/api/admin/products'))
      stats.publishedCount = prodRes.items.filter((p) => p.status === 'published').length
      stats.draftCount = prodRes.items.filter((p) => p.status === 'draft').length
      stats.archivedCount = prodRes.items.filter((p) => p.status === 'archived').length
      stats.recentProducts = prodRes.items.slice(0, 5)
    }

    if (canCatalog) {
      const brandRes = AdminBrandList.parse(await session.adminFetch('/api/admin/brands'))
      stats.brandCount = brandRes.items.length
    }

    if (canAudit) {
      const auditRes = AuditPage.parse(await session.adminFetch('/api/admin/audit', { query: { pageSize: 5 } }))
      stats.recentAudits = auditRes.items
    }
  } catch (err) {
    console.error('Không thể tải dữ liệu dashboard', err)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Bảng điều khiển trung tâm</h1>
        <p class="admin-page-desc">Tổng quan đơn hàng, hàng hóa, trạng thái xuất bản và lịch sử kiểm toán.</p>
      </div>

      <div v-if="canCatalog" class="admin-topbar-actions">
        <NuxtLink to="/admin/products" class="btn btn-primary">
          <span>+ Thêm sản phẩm mới</span>
        </NuxtLink>
      </div>
    </div>

    <div v-if="ORDER_COUNTS.length" class="stat-grid">
      <NuxtLink
        v-for="item in ORDER_COUNTS"
        :key="item.to"
        :to="item.to"
        class="stat-card"
        :data-testid="item.testid"
        style="text-decoration: none; color: inherit"
      >
        <div class="stat-label">{{ item.label }}</div>
        <div class="stat-value">{{ orderCounts[item.to] ?? '–' }}</div>
        <div class="stat-sub">{{ item.sub }}</div>
      </NuxtLink>
    </div>

    <div v-if="canSeeProducts" class="stat-grid">
      <div class="stat-card">
        <div class="stat-label">Sản phẩm đang bán trên Web</div>
        <div class="stat-value" style="color: var(--adm-published)">{{ stats.publishedCount }}</div>
        <div class="stat-sub">Hiển thị trực tiếp cho khách hàng</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Bản thảo đang soạn (Nháp)</div>
        <div class="stat-value" style="color: var(--adm-draft)">{{ stats.draftCount }}</div>
        <div class="stat-sub">Đang hoàn thiện nội dung & biến thể</div>
      </div>

      <div class="stat-card">
        <div class="stat-label">Sản phẩm lưu trữ</div>
        <div class="stat-value" style="color: var(--adm-archived)">{{ stats.archivedCount }}</div>
        <div class="stat-sub">Ngừng kinh doanh, giữ nguyên lịch sử</div>
      </div>

      <div v-if="canCatalog" class="stat-card">
        <div class="stat-label">Thương hiệu</div>
        <div class="stat-value">{{ stats.brandCount }}</div>
        <div class="stat-sub">Đang có trong danh mục</div>
      </div>
    </div>

    <div class="admin-two-col">
      <div v-if="canSeeProducts" class="admin-panel" style="padding: 0; overflow: hidden">
        <div style="padding: 18px 20px 14px; border-bottom: 1px solid var(--adm-border)">
          <div style="display: flex; align-items: center; justify-content: space-between">
            <h2 class="admin-section-title" style="margin: 0">Sản phẩm cập nhật gần nhất</h2>
            <NuxtLink to="/admin/products" class="btn btn-ghost btn-sm">Xem tất cả ›</NuxtLink>
          </div>
        </div>

        <div v-if="loading" style="padding: 32px; text-align: center; color: var(--adm-muted)">Đang nạp dữ liệu...</div>

        <div
          v-else-if="stats.recentProducts.length === 0"
          style="padding: 32px; text-align: center; color: var(--adm-muted)"
        >
          Chưa có sản phẩm nào.
        </div>

        <table v-else class="admin-table">
          <thead>
            <tr>
              <th>Tên sản phẩm</th>
              <th>Thương hiệu</th>
              <th>Biến thể</th>
              <th>Trạng thái</th>
              <th>Cập nhật</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in stats.recentProducts" :key="p.id">
              <td>
                <NuxtLink :to="`/admin/products/${p.id}`">{{ p.name }}</NuxtLink>
                <div v-if="p.modelCode" style="font-size: 11px; color: var(--adm-muted)">Mã mẫu: {{ p.modelCode }}</div>
              </td>
              <td>{{ p.brand.name }}</td>
              <td class="admin-table-num">{{ p.variantCount }}</td>
              <td>
                <ProductStatusBadge :status="p.status" />
              </td>
              <td style="font-size: 12px; color: var(--adm-muted); white-space: nowrap">
                {{ formatDateTime(p.updatedAt) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <div v-if="shortcuts.length" class="admin-panel" style="margin-bottom: 20px">
          <h2 class="admin-section-title">Lối tắt tác vụ</h2>
          <div style="display: flex; flex-direction: column; gap: 8px">
            <NuxtLink
              v-for="shortcut in shortcuts"
              :key="shortcut.to"
              :to="shortcut.to"
              class="btn btn-secondary"
              style="justify-content: flex-start"
            >
              <span>{{ shortcut.label }}</span>
            </NuxtLink>
          </div>
        </div>

        <div v-if="canAudit" class="admin-panel" style="padding: 16px 20px">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px">
            <h2 class="admin-section-title" style="margin: 0">Kiểm toán gần nhất</h2>
            <NuxtLink to="/admin/audit" class="btn btn-ghost btn-sm">Xem đầy đủ</NuxtLink>
          </div>

          <div v-if="stats.recentAudits.length === 0" style="color: var(--adm-muted); font-size: 13px">
            Chưa có ghi nhận kiểm toán.
          </div>

          <div v-else style="display: flex; flex-direction: column; gap: 12px">
            <div
              v-for="log in stats.recentAudits"
              :key="log.id"
              style="padding-bottom: 10px; border-bottom: 1px solid var(--adm-border-subtle); font-size: 12px"
            >
              <div style="display: flex; justify-content: space-between; margin-bottom: 2px">
                <strong style="color: var(--adm-ink)">{{ log.actor.name }}</strong>
                <span style="color: var(--adm-muted)">{{ formatDateTime(log.createdAt) }}</span>
              </div>
              <div style="color: var(--adm-muted)">{{ auditActionLabel(log.action) }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
