<script setup lang="ts">
import type { Permission } from '@ecommerce/shared'

const session = useAdminSession()

const MENU: { to: string; label: string; permission?: Permission | Permission[] }[] = [
  { to: '/admin', label: 'Tổng quan' },
  { to: '/admin/staff', label: 'Nhân viên', permission: 'staff.manage' },
  { to: '/admin/brands', label: 'Thương hiệu', permission: 'catalog.edit' },
  { to: '/admin/categories', label: 'Danh mục', permission: 'catalog.edit' },
  { to: '/admin/attribute-schemas', label: 'Schema thuộc tính', permission: 'catalog.edit' },
  { to: '/admin/products', label: 'Sản phẩm', permission: ['catalog.edit', 'price.edit'] },
  { to: '/admin/commitment-types', label: 'Loại cam kết', permission: 'commitment.edit' },
  { to: '/admin/pages', label: 'Trang nội dung', permission: 'content.edit' },
  { to: '/admin/legal-info', label: 'Thông tin pháp lý', permission: 'content.edit' },
  { to: '/admin/audit', label: 'Audit log', permission: 'audit.view' },
]
// Menu chỉ để dễ dùng; quyền thật vẫn do API kiểm ở mỗi request.
const menu = computed(() => MENU.filter((item) => !item.permission || session.can(item.permission)))
</script>

<template>
  <div>
    <header>
      <nav>
        <NuxtLink v-for="item in menu" :key="item.to" :to="item.to">{{ item.label }}</NuxtLink>
      </nav>
      <span v-if="session.profile.value">{{ session.profile.value.name }}</span>
      <button type="button" @click="session.logout()">Đăng xuất</button>
    </header>
    <slot />
  </div>
</template>
