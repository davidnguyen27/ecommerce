<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'report.view' })

// Tab mặc định của mục Báo cáo; giữ kỳ đang chọn trên query string.
const route = useRoute()
await navigateTo({ path: '/admin/reports/revenue', query: route.query }, { replace: true })
</script>

<template>
  <div />
</template>
