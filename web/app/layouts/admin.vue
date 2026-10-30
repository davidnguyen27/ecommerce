<script setup lang="ts">
import '~/assets/admin.css'
const session = useAdminSession()
const route = useRoute()

// Lọc menu theo quyền thực tế của nhân viên
const visibleGroups = computed(() =>
  ADMIN_MENU_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || session.can(item.permission)),
  })).filter((group) => group.items.length > 0),
)

// Mục đang active là mục có đường dẫn dài nhất khớp với trang, để `/admin/stock/movements` không sáng cả `/admin/stock`
const activeItem = computed(() => {
  const matches = (to: string) =>
    to === '/admin' ? route.path === '/admin' : route.path === to || route.path.startsWith(`${to}/`)
  return ADMIN_MENU_ITEMS.filter((item) => matches(item.to)).sort((a, b) => b.to.length - a.to.length)[0]?.to
})
const isItemActive = (to: string) => activeItem.value === to

// Lấy tiêu đề trang hiện tại cho breadcrumb
const currentTitle = computed(() => {
  return ADMIN_MENU_ITEMS.find((item) => isItemActive(item.to))?.label ?? 'Quản trị'
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
