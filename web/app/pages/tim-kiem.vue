<script setup lang="ts">
import { ATTRIBUTE_FILTER_PREFIX, GENDER_KEY } from '@ecommerce/shared'

// Trang kết quả tìm kiếm; menu Nam / Nữ cũng dẫn về đây với bộ lọc giới tính (ADR 0004).
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

// Kết quả tìm kiếm trùng nội dung với trang sản phẩm, danh mục: không cho index ở mọi URL của trang này.
useSeo({ title, description: 'Tìm sản phẩm theo tên, thương hiệu, mã mẫu hoặc SKU.', noindex: true })
</script>

<template>
  <main>
    <h1>{{ title }}</h1>
    <ProductSearch empty="Không tìm thấy sản phẩm phù hợp. Thử bỏ bớt bộ lọc hoặc gõ từ khóa khác." />
  </main>
</template>
