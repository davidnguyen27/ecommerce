<script setup lang="ts">
import { PublishedPage } from '@ecommerce/shared'

const route = useRoute()
const { apiBase } = useRuntimeConfig()
const slug = computed(() => String(route.params.slug))

const { data, error } = await useAsyncData(`page-${slug.value}`, async () => {
  const body = await $fetch(`/api/pages/${encodeURIComponent(slug.value)}`, { baseURL: apiBase })
  return PublishedPage.parse(body)
})

if (error.value) {
  const notFound = (error.value as { statusCode?: number }).statusCode === 404
  throw createError({
    statusCode: notFound ? 404 : 502,
    message: notFound ? 'Không tìm thấy trang' : 'Không tải được trang',
    fatal: true,
  })
}

const html = computed(() => (data.value ? renderMarkdown(data.value.body) : ''))
// Cố định múi giờ để ngày render ở server và trình duyệt trùng nhau.
const publishedOn = computed(() =>
  data.value ? new Date(data.value.publishedAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '',
)
useSeo({
  title: () => data.value?.title ?? '',
  description: () => (data.value ? excerpt(markdownText(data.value.body)) || data.value.title : ''),
  canonicalPath: () => `/trang/${slug.value}`,
})
</script>

<template>
  <main v-if="data" class="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
    <h1>{{ data.title }}</h1>
    <p class="mt-3 text-sm text-muted-foreground">Phiên bản {{ data.version }}, cập nhật {{ publishedOn }}</p>
    <!-- renderMarkdown đã thoát HTML trong nội dung -->
    <article class="prose-content mt-10 border-t border-border pt-10" v-html="html" />
  </main>
</template>
