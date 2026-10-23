<script setup lang="ts">
import { PublicCategory } from '@ecommerce/shared'

const route = useRoute()
const { apiBase } = useRuntimeConfig()
const slug = computed(() => String(route.params.slug))

const { data, error } = await useAsyncData(`category-${slug.value}`, async () => {
  const body = await $fetch(`/api/categories/${encodeURIComponent(slug.value)}`, { baseURL: apiBase })
  return PublicCategory.parse(body)
})

if (error.value) {
  const notFound = (error.value as { statusCode?: number }).statusCode === 404
  throw createError({
    statusCode: notFound ? 404 : 502,
    message: notFound ? 'Không tìm thấy danh mục' : 'Không tải được danh mục',
    fatal: true,
  })
}

useHead({ title: () => data.value?.name ?? '' })
</script>

<template>
  <main v-if="data">
    <nav aria-label="Đường dẫn">
      <span>{{ PRODUCT_TYPE_LABELS[data.productType] }}</span>
      <template v-for="ancestor in data.ancestors" :key="ancestor.slug">
        › <NuxtLink :to="`/danh-muc/${ancestor.slug}`">{{ ancestor.name }}</NuxtLink>
      </template>
    </nav>
    <h1>{{ data.name }}</h1>
    <ul v-if="data.children.length">
      <li v-for="child in data.children" :key="child.slug">
        <NuxtLink :to="`/danh-muc/${child.slug}`">{{ child.name }}</NuxtLink>
      </li>
    </ul>
    <!-- Sản phẩm có từ ticket 09; tới lúc đó danh mục nào cũng trống. -->
    <p>Chưa có sản phẩm trong danh mục này.</p>
  </main>
</template>
