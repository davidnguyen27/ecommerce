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

useHead({ title: () => data.value?.name ?? '' })
</script>

<template>
  <main v-if="data">
    <h1>{{ data.name }}</h1>
    <p v-if="data.description">{{ data.description }}</p>
    <!-- Sản phẩm có từ ticket 09; tới lúc đó thương hiệu nào cũng trống. -->
    <p>Chưa có sản phẩm của thương hiệu này.</p>
  </main>
</template>
