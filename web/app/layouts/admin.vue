<script setup lang="ts">
import '~/assets/admin.css'
import type { Permission } from '@ecommerce/shared'
import {
  BadgeCheck,
  FileSpreadsheet,
  FileText,
  FolderTree,
  History,
  Images,
  LayoutDashboard,
  ListChecks,
  Package,
  Scale,
  ScrollText,
  Tag,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-vue-next'

/** Ai soạn danh mục, đặt giá hoặc giữ kho đều xem được tồn. */
const STOCK_VIEW: Permission[] = ['catalog.edit', 'price.edit', 'stock.adjust']

const session = useAdminSession()
const route = useRoute()

type MenuItem = { to: string; label: string; icon: LucideIcon; permission?: Permission | Permission[] }
type MenuGroup = { title: string; items: MenuItem[] }

const MENU_GROUPS: MenuGroup[] = [
  {
    title: 'Tổng quan',
    items: [{ to: '/admin', label: 'Bảng điều khiển', icon: LayoutDashboard }],
  },
  {
    title: 'Hàng hóa & Danh mục',
    items: [
      { to: '/admin/products', label: 'Sản phẩm', icon: Package, permission: ['catalog.edit', 'price.edit'] },
      { to: '/admin/import', label: 'Import từ Excel', icon: FileSpreadsheet, permission: 'catalog.edit' },
      { to: '/admin/bulk-images', label: 'Ảnh hàng loạt', icon: Images, permission: 'media.upload' },
      { to: '/admin/brands', label: 'Thương hiệu', icon: Tag, permission: 'catalog.edit' },
      { to: '/admin/categories', label: 'Cây danh mục', icon: FolderTree, permission: 'catalog.edit' },
      { to: '/admin/attribute-schemas', label: 'Schema thuộc tính', icon: ListChecks, permission: 'catalog.edit' },
      { to: '/admin/commitment-types', label: 'Loại cam kết', icon: BadgeCheck, permission: 'commitment.edit' },
    ],
  },
  {
    title: 'Kho',
    items: [
      { to: '/admin/stock', label: 'Tồn kho', icon: Warehouse, permission: STOCK_VIEW },
      { to: '/admin/stock/movements', label: 'Sổ xuất nhập', icon: ScrollText, permission: STOCK_VIEW },
    ],
  },
  {
    title: 'Vận hành & Nhân sự',
    items: [
      { to: '/admin/staff', label: 'Nhân sự & Vai trò', icon: Users, permission: 'staff.manage' },
      { to: '/admin/audit', label: 'Nhật ký kiểm toán', icon: History, permission: 'audit.view' },
    ],
  },
  {
    title: 'Nội dung & Pháp lý',
    items: [
      { to: '/admin/pages', label: 'Trang bài viết', icon: FileText, permission: 'content.edit' },
      { to: '/admin/legal-info', label: 'Thông tin pháp lý', icon: Scale, permission: 'content.edit' },
    ],
  },
]

// Lọc menu theo quyền thực tế của nhân viên
const visibleGroups = computed(() =>
  MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || session.can(item.permission)),
  })).filter((group) => group.items.length > 0),
)

// Mục đang active là mục có đường dẫn dài nhất khớp với trang, để `/admin/stock/movements` không sáng cả `/admin/stock`
const activeItem = computed(() => {
  const matches = (to: string) =>
    to === '/admin' ? route.path === '/admin' : route.path === to || route.path.startsWith(`${to}/`)
  return MENU_GROUPS.flatMap((g) => g.items)
    .filter((item) => matches(item.to))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to
})
const isItemActive = (to: string) => activeItem.value === to

// Lấy tiêu đề trang hiện tại cho breadcrumb
const currentTitle = computed(() => {
  for (const group of MENU_GROUPS) {
    for (const item of group.items) {
      if (isItemActive(item.to)) return item.label
    }
  }
  return 'Quản trị'
})

const userInitials = computed(() => {
  const name = session.profile.value?.name || 'Admin'
  const parts = name.trim().split(/\s+/)
  const first = parts[0]
  const last = parts[parts.length - 1]
  if (parts.length >= 2 && first && last && first[0] && last[0]) {
    return (first[0] + last[0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
})

const roleLabels: Record<string, string> = {
  owner: 'Chủ sở hữu',
  sales: 'Bán hàng',
  warehouse: 'Thủ kho',
  accountant: 'Kế toán',
}

const displayRoles = computed(() => {
  const roles = session.profile.value?.roles || []
  return roles.map((r) => roleLabels[r] || r).join(', ')
})
</script>

<template>
  <div class="admin-shell">
    <!-- Left Rail Sidebar -->
    <aside class="admin-sidebar">
      <div class="admin-sidebar-header">
        <NuxtLink to="/admin" class="admin-brand-mark">
          <div class="admin-brand-icon">A</div>
          <div>
            <div class="admin-brand-text">ATELIER</div>
            <div class="admin-brand-sub">Hệ Thống Bán Lẻ Hàng Hiệu</div>
          </div>
        </NuxtLink>
      </div>

      <nav class="admin-sidebar-nav" aria-label="Điều hướng quản trị">
        <div v-for="group in visibleGroups" :key="group.title" class="admin-nav-group">
          <div class="admin-nav-group-title">{{ group.title }}</div>
          <NuxtLink
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            class="admin-nav-link"
            :class="{ active: isItemActive(item.to) }"
          >
            <component :is="item.icon" class="admin-nav-icon" aria-hidden="true" />
            <span>{{ item.label }}</span>
          </NuxtLink>
        </div>
      </nav>

      <div class="admin-sidebar-footer">
        <div v-if="session.profile.value" class="admin-user-info">
          <div class="admin-user-avatar">{{ userInitials }}</div>
          <div class="admin-user-meta">
            <div class="admin-user-name">{{ session.profile.value.name }}</div>
            <div class="admin-user-role">{{ displayRoles }}</div>
          </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" style="width: 100%" @click="session.logout()">
          Đăng xuất
        </button>
      </div>
    </aside>

    <!-- Main Viewport Canvas -->
    <div class="admin-viewport">
      <header class="admin-topbar">
        <div class="admin-breadcrumb">
          <NuxtLink to="/admin">Quản trị</NuxtLink>
          <span class="admin-breadcrumb-separator">/</span>
          <span class="admin-breadcrumb-current">{{ currentTitle }}</span>
        </div>

        <div class="admin-topbar-actions">
          <NuxtLink to="/" target="_blank" class="btn btn-ghost btn-sm">
            <span>Xem website khách</span>
            <span style="font-size: 11px; opacity: 0.7">↗</span>
          </NuxtLink>
        </div>
      </header>

      <main class="admin-content-area">
        <slot />
      </main>
    </div>
  </div>
</template>
