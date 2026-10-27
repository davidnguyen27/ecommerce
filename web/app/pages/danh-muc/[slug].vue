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
  <main v-if="data" class="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
    <nav aria-label="Đường dẫn" class="mb-3 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      <span>{{ PRODUCT_TYPE_LABELS[data.productType] }}</span>
      <template v-for="ancestor in data.ancestors" :key="ancestor.slug">
        <span aria-hidden="true">/</span>
        <NuxtLink :to="`/danh-muc/${ancestor.slug}`" class="transition-colors hover:text-foreground">{{
          ancestor.name
        }}</NuxtLink>
      </template>
    </nav>
    <h1>{{ data.name }}</h1>
    <ul v-if="data.children.length" class="mt-6 flex flex-wrap gap-2">
      <li v-for="child in data.children" :key="child.slug">
        <NuxtLink
          :to="`/danh-muc/${child.slug}`"
          class="inline-flex h-10 items-center rounded-full border border-border bg-card px-4 text-sm font-medium transition-colors hover:border-foreground"
          >{{ child.name }}</NuxtLink
        >
      </li>
    </ul>
    <div class="h-8" />
    <ProductSearch :category="data.slug" empty="Chưa có sản phẩm phù hợp trong danh mục này." />
  </main>
</template>
