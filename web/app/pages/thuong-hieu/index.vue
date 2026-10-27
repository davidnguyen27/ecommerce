<script setup lang="ts">
import { PublicBrandList } from '@ecommerce/shared'
import { ArrowRight } from 'lucide-vue-next'

const { apiBase } = useRuntimeConfig()

const { data, error } = await useAsyncData('brands', async () => {
  const body = await $fetch('/api/brands', { baseURL: apiBase })
  return PublicBrandList.parse(body).items
})

if (error.value) throw createError({ statusCode: 502, message: 'Không tải được danh sách thương hiệu', fatal: true })

useSeo({ title: 'Thương hiệu', description: 'Các thương hiệu đang bán trên website.' })
</script>

<template>
  <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
    <h1>Thương hiệu</h1>
    <p class="mt-3 text-muted-foreground">Các thương hiệu doanh nghiệp đang nhập khẩu và bán.</p>
    <ul v-if="data?.length" class="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <li v-for="brand in data" :key="brand.slug">
        <NuxtLink
          :to="`/thuong-hieu/${brand.slug}`"
          class="group flex h-24 items-center justify-between rounded-lg border border-border bg-card px-5 transition-colors hover:border-foreground"
        >
          <span class="font-display text-lg font-semibold">{{ brand.name }}</span>
          <ArrowRight
            class="h-4 w-4 text-muted-foreground transition-transform motion-safe:group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </NuxtLink>
      </li>
    </ul>
    <p v-else class="mt-10 text-muted-foreground">Chưa có thương hiệu nào.</p>
  </main>
</template>
