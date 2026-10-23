<script setup lang="ts">
import { ProductCardList, PublicBrand } from '@ecommerce/shared'

const route = useRoute()
const { apiBase } = useRuntimeConfig()
const slug = computed(() => String(route.params.slug))

const { data, error } = await useAsyncData(`brand-${slug.value}`, async () => {
  const body = await $fetch(`/api/brands/${encodeURIComponent(slug.value)}`, { baseURL: apiBase })
  return PublicBrand.parse(body)
})

if (error.value) {
  const notFound = (error.value as { statusCode?: number }).statusCode === 404
  throw createError({
    statusCode: notFound ? 404 : 502,
    message: notFound ? 'Không tìm thấy thương hiệu' : 'Không tải được thương hiệu',
    fatal: true,
  })
}

const page = computed(() => Number(route.query.trang) || 1)
const { data: products, error: productsError } = await useAsyncData(
  () => `brand-products-${slug.value}-${page.value}`,
  async () => {
    const body = await $fetch('/api/products', { baseURL: apiBase, query: { brand: slug.value, page: page.value } })
    return ProductCardList.parse(body)
  },
)

useHead({ title: () => data.value?.name ?? '' })
</script>

<template>
  <main v-if="data">
    <img
      v-if="data.logo"
      :src="imageSrc(data.logo, 160)"
      :srcset="srcset(data.logo)"
      sizes="160px"
      :alt="`Logo ${data.name}`"
      class="logo"
    />
    <h1>{{ data.name }}</h1>
    <p v-if="data.description">{{ data.description }}</p>
    <ProductCardGrid v-if="products" :list="products" empty="Chưa có sản phẩm của thương hiệu này." />
    <p v-else-if="productsError" role="alert">Không tải được sản phẩm.</p>
  </main>
</template>

<style scoped>
.logo {
  width: 160px;
  height: auto;
}
</style>
