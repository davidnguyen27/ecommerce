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

useHead({ title: 'Xác minh email' })
</script>

<template>
  <main>
    <h1>Xác minh email</h1>
    <p v-if="error" role="alert">
      Link xác minh không hợp lệ hoặc đã hết hạn. Bạn có thể gửi lại thư xác minh trong
      <NuxtLink to="/tai-khoan">trang tài khoản</NuxtLink>.
    </p>
    <p v-else>Email của bạn đã được xác minh. <NuxtLink to="/tai-khoan">Về trang tài khoản</NuxtLink></p>
  </main>
</template>
