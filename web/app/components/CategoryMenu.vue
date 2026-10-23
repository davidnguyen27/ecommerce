<script setup lang="ts">
import type { CategoryNode } from '@ecommerce/shared'

defineProps<{ categories: CategoryNode[] }>()
</script>

<template>
  <ul>
    <li v-for="category in categories" :key="category.slug">
      <NuxtLink :to="`/danh-muc/${category.slug}`">{{ category.name }}</NuxtLink>
      <CategoryMenu v-if="category.children.length" :categories="category.children" />
    </li>
  </ul>
</template>
