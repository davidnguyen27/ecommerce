<script setup lang="ts">
import type { CategoryNode } from '@ecommerce/shared'

defineProps<{ categories: CategoryNode[]; nested?: boolean }>()
</script>

<template>
  <ul :class="nested ? 'ml-1 mt-1 space-y-0.5 border-l border-border pl-3' : 'space-y-0.5'">
    <li v-for="category in categories" :key="category.slug">
      <NuxtLink
        :to="`/danh-muc/${category.slug}`"
        class="block rounded py-1.5 transition-colors hover:text-highlight"
        :class="nested ? 'text-sm text-muted-foreground' : 'text-[15px] font-medium text-foreground'"
        active-class="text-highlight"
        >{{ category.name }}</NuxtLink
      >
      <CategoryMenu v-if="category.children.length" :categories="category.children" nested />
    </li>
  </ul>
</template>
