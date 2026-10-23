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

useHead({ title: 'Đặt lại mật khẩu' })
</script>

<template>
  <main>
    <h1>Đặt lại mật khẩu</h1>
    <p v-if="!token" role="alert">
      Link đặt lại mật khẩu không hợp lệ. <NuxtLink to="/quen-mat-khau">Yêu cầu link mới</NuxtLink>
    </p>
    <p v-else-if="done" role="status">
      Đã đổi mật khẩu. Mọi thiết bị đang đăng nhập đã bị đăng xuất.
      <NuxtLink to="/dang-nhap">Đăng nhập bằng mật khẩu mới</NuxtLink>
    </p>
    <form v-else @submit.prevent="submit">
      <label>
        Mật khẩu mới (ít nhất {{ CUSTOMER_PASSWORD_MIN_LENGTH }} ký tự)
        <input
          v-model="password"
          type="password"
          name="password"
          autocomplete="new-password"
          :minlength="CUSTOMER_PASSWORD_MIN_LENGTH"
          required
        />
      </label>
      <p v-if="error" role="alert">{{ error }} <NuxtLink to="/quen-mat-khau">Yêu cầu link mới</NuxtLink></p>
      <button type="submit" :disabled="submitting">Đặt mật khẩu mới</button>
    </form>
  </main>
</template>
