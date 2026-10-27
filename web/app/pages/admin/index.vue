<script setup lang="ts">
import { AdminBrandList, AdminProductList, AuditPage } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth' })

const session = useAdminSession()
const canCatalog = session.can('catalog.edit')
const canPrice = session.can('price.edit')
const canAudit = session.can('audit.view')

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
    if (canCatalog || canPrice) {
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

const STATUS_LABELS = { draft: 'Nháp', published: 'Đã xuất bản', archived: 'Lưu trữ' } as const
const STATUS_BADGES = { draft: 'badge-draft', published: 'badge-published', archived: 'badge-archived' } as const

const formatTime = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}
</script>

<template>
  <div>
    <!-- Page Header -->
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Bảng điều khiển trung tâm</h1>
        <p class="admin-page-desc">
          Tổng quan vận hành hàng hóa thời trang cao cấp, trạng thái xuất bản và lịch sử kiểm toán.
        </p>
      </div>

      <div v-if="canCatalog" class="admin-topbar-actions">
        <NuxtLink to="/admin/products" class="btn btn-primary">
          <span>+ Thêm sản phẩm mới</span>
        </NuxtLink>
      </div>
    </div>

    <!-- Stat Metrics Grid -->
    <div class="stat-grid">
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

      <div class="stat-card">
        <div class="stat-label">Thương hiệu đối tác</div>
        <div class="stat-value">{{ stats.brandCount }}</div>
        <div class="stat-sub">Nhà mốt & thương hiệu quốc tế</div>
      </div>
    </div>

    <!-- Main Workspace Split -->
    <div class="admin-two-col">
      <!-- Cột Trái: Sản phẩm mới cập nhật -->
      <div class="admin-panel" style="padding: 0; overflow: hidden">
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
                <span class="badge" :class="STATUS_BADGES[p.status]">
                  <span class="badge-dot" />
                  {{ STATUS_LABELS[p.status] }}
                </span>
              </td>
              <td style="font-size: 12px; color: var(--adm-muted)">{{ formatTime(p.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Cột Phải: Lối tắt & Nhật ký Audit gần nhất -->
      <div>
        <!-- Lối tắt tác vụ nhanh -->
        <div class="admin-panel" style="margin-bottom: 20px">
          <h2 class="admin-section-title">Lối tắt tác vụ</h2>
          <div style="display: flex; flex-direction: column; gap: 8px">
            <NuxtLink to="/admin/products" class="btn btn-secondary" style="justify-content: flex-start">
              <span>Sản phẩm & Biến thể</span>
            </NuxtLink>
            <NuxtLink to="/admin/brands" class="btn btn-secondary" style="justify-content: flex-start">
              <span>Quản lý Thương hiệu & Logo</span>
            </NuxtLink>
            <NuxtLink to="/admin/categories" class="btn btn-secondary" style="justify-content: flex-start">
              <span>Cây Danh mục 5 Nhóm hàng</span>
            </NuxtLink>
            <NuxtLink to="/admin/pages" class="btn btn-secondary" style="justify-content: flex-start">
              <span>Soạn Chính sách Đổi trả / Bảo hành</span>
            </NuxtLink>
          </div>
        </div>

        <!-- Nhật ký Audit gần nhất -->
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
                <span style="color: var(--adm-muted)">{{ formatTime(log.createdAt) }}</span>
              </div>
              <div style="color: var(--adm-muted)">
                Hành động: <code style="font-family: var(--adm-mono); color: var(--adm-ink)">{{ log.action }}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
