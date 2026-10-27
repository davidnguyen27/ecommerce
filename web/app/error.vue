<script setup lang="ts">
import type { NuxtError } from '#app'

// Trang lỗi của Nuxt không đi qua app.vue; bọc layout mặc định để trang lỗi cũng có chân trang pháp lý.
const props = defineProps<{ error: NuxtError }>()
const notFound = computed(() => props.error.statusCode === 404)
</script>

<template>
  <NuxtLayout>
    <main class="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <p class="font-display text-6xl font-semibold text-highlight">{{ error.statusCode }}</p>
      <h1 class="mt-4">{{ notFound ? 'Không tìm thấy trang' : 'Đã có lỗi xảy ra' }}</h1>
      <p v-if="error.message" class="mt-3 text-muted-foreground">{{ error.message }}</p>
      <div class="mt-8 flex flex-wrap justify-center gap-3">
        <NuxtLink to="/" class="btn-primary" @click="clearError()">Về trang chủ</NuxtLink>
        <NuxtLink to="/tim-kiem" class="btn-outline" @click="clearError()">Xem sản phẩm</NuxtLink>
      </div>
    </main>
  </NuxtLayout>
</template>
