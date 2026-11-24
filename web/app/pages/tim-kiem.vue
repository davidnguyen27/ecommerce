<script setup lang="ts">
import { ATTRIBUTE_FILTER_PREFIX, GENDER_KEY } from '@ecommerce/shared'

// Search results page; the Nam / Nữ menu also lands here with a gender filter (ADR 0004).
const route = useRoute()
const text = (name: string) => {
  const value = [route.query[name]].flat()[0]
  return typeof value === 'string' ? value.trim() : ''
}

const title = computed(() => {
  const q = text('q')
  if (q) return `Kết quả cho “${q}”`
  const gender = text(ATTRIBUTE_FILTER_PREFIX + GENDER_KEY)
  return gender ? `Sản phẩm ${gender}` : 'Tất cả sản phẩm'
})

// Search results duplicate product and category pages: no indexing on any URL of this page.
useSeo({ title, description: 'Tìm sản phẩm theo tên, thương hiệu, mã mẫu hoặc SKU.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
    <p class="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tìm kiếm</p>
    <h1>{{ title }}</h1>
    <div class="h-8" />
    <ProductSearch empty="Không tìm thấy sản phẩm phù hợp. Thử bỏ bớt bộ lọc hoặc gõ từ khóa khác." />
  </main>
</template>
