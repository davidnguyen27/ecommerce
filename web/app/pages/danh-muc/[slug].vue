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

useSeo({
  title: () => data.value?.name ?? '',
  description: () =>
    data.value
      ? `${data.value.name} trong nhóm ${PRODUCT_TYPE_LABELS[data.value.productType]}: xem và lọc sản phẩm.`
      : '',
  canonicalPath: () => listingCanonicalPath(`/danh-muc/${slug.value}`, route.query),
  noindex: () => isFilteredListing(route.query),
})
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
    <ProductSearch :category="data.slug" empty="Chưa có sản phẩm phù hợp trong danh mục này." />
  </main>
</template>
