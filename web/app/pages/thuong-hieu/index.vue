<script setup lang="ts">
import { PublicBrandList } from '@ecommerce/shared'

const { apiBase } = useRuntimeConfig()

const { data, error } = await useAsyncData('brands', async () => {
  const body = await $fetch('/api/brands', { baseURL: apiBase })
  return PublicBrandList.parse(body).items
})

if (error.value) throw createError({ statusCode: 502, message: 'Không tải được danh sách thương hiệu', fatal: true })

useSeo({ title: 'Thương hiệu', description: 'Các thương hiệu đang bán trên website.' })
</script>

<template>
  <main>
    <h1>Thương hiệu</h1>
    <ul v-if="data?.length">
      <li v-for="brand in data" :key="brand.slug">
        <NuxtLink :to="`/thuong-hieu/${brand.slug}`">{{ brand.name }}</NuxtLink>
      </li>
    </ul>
    <p v-else>Chưa có thương hiệu nào.</p>
  </main>
</template>
