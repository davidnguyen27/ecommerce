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

// Trang riêng của từng khách, không có nội dung để index.
useSeo({ title: 'Quên mật khẩu', description: 'Lấy lại mật khẩu tài khoản khách hàng.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-md px-4 py-12 sm:py-20">
    <h1>Quên mật khẩu</h1>
    <p v-if="sent" role="status" class="notice-ok mt-8">
      Nếu email này có tài khoản, chúng tôi đã gửi link đặt lại mật khẩu. Link dùng được một lần, trong 1 giờ.
    </p>
    <form v-else class="mt-8 space-y-5 rounded-lg border border-border bg-card p-6 sm:p-8" @submit.prevent="submit">
      <p class="text-sm text-muted-foreground">
        Nhập email của tài khoản, chúng tôi sẽ gửi link để bạn đặt mật khẩu mới.
      </p>
      <label class="field">
        Email
        <input
          class="field-input"
          v-model="email"
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          required
        />
      </label>
      <p v-if="error" role="alert" class="notice-error">{{ error }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="submitting">Gửi link đặt lại</button>
    </form>
    <p class="mt-6 text-center text-sm"><NuxtLink to="/dang-nhap" class="link">Quay lại đăng nhập</NuxtLink></p>
  </main>
</template>
