<script setup lang="ts">
import type { ProductStatus } from '@ecommerce/shared'

defineProps<{ status: ProductStatus }>()
</script>

<template>
  <span class="badge" :class="`badge-${status}`">
    <span class="badge-dot" />
    {{ PRODUCT_STATUS_LABELS[status] }}
  </span>
</template>
