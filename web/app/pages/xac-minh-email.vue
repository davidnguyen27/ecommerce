<script setup lang="ts">
const route = useRoute()
const { apiBase } = useRuntimeConfig()
const token = typeof route.query.token === 'string' ? route.query.token : ''

// Xác minh ngay lúc render phía server; link chỉ cần mở một lần.
const { error } = await useAsyncData('verify-email', async () => {
  if (!token) throw new Error('Thiếu token')
  await $fetch('/api/auth/verify-email', { baseURL: apiBase, method: 'POST', body: { token } })
  return true
})

// Trang riêng của từng khách, không có nội dung để index.
useSeo({ title: 'Xác minh email', description: 'Xác minh email tài khoản khách hàng.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-md px-4 py-12 sm:py-20">
    <h1>Xác minh email</h1>
    <p v-if="error" role="alert" class="notice-error mt-8">
      Link xác minh không hợp lệ hoặc đã hết hạn. Bạn có thể gửi lại thư xác minh trong
      <NuxtLink to="/tai-khoan" class="link">trang tài khoản</NuxtLink>.
    </p>
    <p v-else role="status" class="notice-ok mt-8">
      Email của bạn đã được xác minh. <NuxtLink to="/tai-khoan" class="link">Về trang tài khoản</NuxtLink>
    </p>
  </main>
</template>
