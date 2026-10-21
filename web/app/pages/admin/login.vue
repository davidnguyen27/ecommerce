<script setup lang="ts">
import { ApiErrorBody } from '@ecommerce/shared'

const session = useAdminSession()
const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

async function submit() {
  submitting.value = true
  error.value = null
  try {
    await session.login(email.value, password.value)
    await navigateTo('/admin')
  } catch (err) {
    const body = ApiErrorBody.safeParse((err as { data?: unknown }).data)
    error.value = body.success ? body.data.error.message : 'Không kết nối được máy chủ'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <main>
    <h1>Đăng nhập quản trị</h1>
    <form @submit.prevent="submit">
      <label>
        Email
        <input v-model="email" type="email" autocomplete="username" required />
      </label>
      <label>
        Mật khẩu
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="submitting">Đăng nhập</button>
    </form>
  </main>
</template>
