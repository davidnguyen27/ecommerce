<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'report.view' })

// Default tab of Reports; keeps the selected period in the query string.
const route = useRoute()
await navigateTo({ path: '/admin/reports/revenue', query: route.query }, { replace: true })
</script>

<template>
  <div />
</template>
