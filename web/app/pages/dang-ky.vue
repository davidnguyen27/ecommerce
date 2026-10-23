<script setup lang="ts">
import { CUSTOMER_PASSWORD_MIN_LENGTH, PRIVACY_POLICY_SLUG } from '@ecommerce/shared'

const session = useCustomerSession()
const email = ref('')
const password = ref('')
const acceptPrivacyPolicy = ref(false)
const error = ref<string | null>(null)
const submitting = ref(false)

async function submit() {
  if (!acceptPrivacyPolicy.value) {
    error.value = 'Cần đồng ý với chính sách bảo mật để đăng ký'
    return
  }
  submitting.value = true
  error.value = null
  try {
    await session.register({ email: email.value, password: password.value, acceptPrivacyPolicy: true })
    await navigateTo('/tai-khoan')
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    submitting.value = false
  }
}

useHead({ title: 'Đăng ký' })
</script>

<template>
  <main>
    <h1>Đăng ký tài khoản</h1>
    <form @submit.prevent="submit">
      <label>
        Email
        <input v-model="email" type="email" name="email" autocomplete="email" inputmode="email" required />
      </label>
      <label>
        Mật khẩu (ít nhất {{ CUSTOMER_PASSWORD_MIN_LENGTH }} ký tự)
        <input
          v-model="password"
          type="password"
          name="password"
          autocomplete="new-password"
          :minlength="CUSTOMER_PASSWORD_MIN_LENGTH"
          required
        />
      </label>
      <label>
        <input v-model="acceptPrivacyPolicy" type="checkbox" name="acceptPrivacyPolicy" required />
        Tôi đồng ý với
        <NuxtLink :to="`/trang/${PRIVACY_POLICY_SLUG}`" target="_blank">chính sách bảo mật</NuxtLink>
        về xử lý dữ liệu cá nhân
      </label>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="submitting">Đăng ký</button>
    </form>
    <p>Đã có tài khoản? <NuxtLink to="/dang-nhap">Đăng nhập</NuxtLink></p>
  </main>
</template>
