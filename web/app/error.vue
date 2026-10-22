<script setup lang="ts">
import type { NuxtError } from '#app'

// Trang lỗi của Nuxt không đi qua app.vue; bọc layout mặc định để trang lỗi cũng có chân trang pháp lý.
const props = defineProps<{ error: NuxtError }>()
const notFound = computed(() => props.error.statusCode === 404)
</script>

<template>
  <NuxtLayout>
    <main>
      <h1>{{ notFound ? 'Không tìm thấy trang' : 'Đã có lỗi xảy ra' }}</h1>
      <p><NuxtLink to="/" @click="clearError()">Về trang chủ</NuxtLink></p>
    </main>
  </NuxtLayout>
</template>
