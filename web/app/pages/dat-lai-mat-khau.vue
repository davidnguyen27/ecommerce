<script setup lang="ts">
import { CUSTOMER_PASSWORD_MIN_LENGTH, type ResetPasswordRequest } from '@ecommerce/shared'

// Token chỉ được dùng khi khách gửi form, không dùng lúc render, để mở link (kể cả do trình quét thư mở) không tiêu token.
const route = useRoute()
const token = typeof route.query.token === 'string' ? route.query.token : ''
const password = ref('')
const error = ref<string | null>(null)
const done = ref(false)
const submitting = ref(false)

async function submit() {
  submitting.value = true
  error.value = null
  try {
    const body: ResetPasswordRequest = { token, password: password.value }
    await $fetch('/api/auth/reset-password', { method: 'POST', body })
    done.value = true
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    submitting.value = false
  }
}

// Trang riêng của từng khách, không có nội dung để index.
useSeo({ title: 'Đặt lại mật khẩu', description: 'Đặt lại mật khẩu tài khoản khách hàng.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-md px-4 py-12 sm:py-20">
    <h1>Đặt lại mật khẩu</h1>
    <p v-if="!token" role="alert" class="notice-error mt-8">
      Link đặt lại mật khẩu không hợp lệ. <NuxtLink to="/quen-mat-khau" class="link">Yêu cầu link mới</NuxtLink>
    </p>
    <p v-else-if="done" role="status" class="notice-ok mt-8">
      Đã đổi mật khẩu. Mọi thiết bị đang đăng nhập đã bị đăng xuất.
      <NuxtLink to="/dang-nhap" class="link">Đăng nhập bằng mật khẩu mới</NuxtLink>
    </p>
    <form v-else class="mt-8 space-y-5 rounded-lg border border-border bg-card p-6 sm:p-8" @submit.prevent="submit">
      <label class="field">
        Mật khẩu mới (ít nhất {{ CUSTOMER_PASSWORD_MIN_LENGTH }} ký tự)
        <input
          class="field-input"
          v-model="password"
          type="password"
          name="password"
          autocomplete="new-password"
          :minlength="CUSTOMER_PASSWORD_MIN_LENGTH"
          required
        />
      </label>
      <p v-if="error" role="alert" class="notice-error">
        {{ error }} <NuxtLink to="/quen-mat-khau" class="link">Yêu cầu link mới</NuxtLink>
      </p>
      <button type="submit" class="btn-primary w-full" :disabled="submitting">Đặt mật khẩu mới</button>
    </form>
  </main>
</template>
