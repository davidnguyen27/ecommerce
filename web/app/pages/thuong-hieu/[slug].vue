<script setup lang="ts">
import { PublicBrand } from '@ecommerce/shared'

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

useSeo({
  title: () => data.value?.name ?? '',
  description: () =>
    data.value ? excerpt(data.value.description || `Sản phẩm của thương hiệu ${data.value.name}.`) : '',
  canonicalPath: () => listingCanonicalPath(`/thuong-hieu/${slug.value}`, route.query),
  image: () => data.value?.logo?.originalUrl,
  noindex: () => isFilteredListing(route.query),
})
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
    <ProductSearch :brand="data.slug" empty="Chưa có sản phẩm của thương hiệu này." />
  </main>
</template>

<style scoped>
.logo {
  width: 160px;
  height: auto;
}
</style>
