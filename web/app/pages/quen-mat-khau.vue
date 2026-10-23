<script setup lang="ts">
import type { ForgotPasswordRequest } from '@ecommerce/shared'

const email = ref('')
const error = ref<string | null>(null)
const sent = ref(false)
const submitting = ref(false)

async function submit() {
  submitting.value = true
  error.value = null
  try {
    const body: ForgotPasswordRequest = { email: email.value }
    await $fetch('/api/auth/forgot-password', { method: 'POST', body })
    sent.value = true
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    submitting.value = false
  }
}

useHead({ title: 'Quên mật khẩu' })
</script>

<template>
  <main>
    <h1>Quên mật khẩu</h1>
    <p v-if="sent" role="status">
      Nếu email này có tài khoản, chúng tôi đã gửi link đặt lại mật khẩu. Link dùng được một lần, trong 1 giờ.
    </p>
    <form v-else @submit.prevent="submit">
      <p>Nhập email của tài khoản, chúng tôi sẽ gửi link để bạn đặt mật khẩu mới.</p>
      <label>
        Email
        <input v-model="email" type="email" name="email" autocomplete="email" inputmode="email" required />
      </label>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="submitting">Gửi link đặt lại</button>
    </form>
    <p><NuxtLink to="/dang-nhap">Quay lại đăng nhập</NuxtLink></p>
  </main>
</template>
