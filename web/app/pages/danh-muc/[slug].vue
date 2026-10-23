<script setup lang="ts">
import { ProductCardList, PublicCategory } from '@ecommerce/shared'

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

const page = computed(() => Number(route.query.trang) || 1)
const { data: products, error: productsError } = await useAsyncData(
  () => `category-products-${slug.value}-${page.value}`,
  async () => {
    const body = await $fetch('/api/products', {
      baseURL: apiBase,
      query: { category: slug.value, page: page.value },
    })
    return ProductCardList.parse(body)
  },
)

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
    <ProductCardGrid v-if="products" :list="products" empty="Chưa có sản phẩm trong danh mục này." />
    <p v-else-if="productsError" role="alert">Không tải được sản phẩm.</p>
  </main>
</template>
