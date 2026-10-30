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

// Trang riêng của từng khách, không có nội dung để index.
useSeo({ title: 'Đăng ký', description: 'Đăng ký tài khoản khách hàng.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-md px-4 py-12 sm:py-20">
    <h1>Đăng ký tài khoản</h1>
    <p class="mt-2 text-sm text-muted-foreground">Tạo tài khoản bằng email của bạn.</p>
    <form class="mt-8 space-y-5 rounded-lg border border-border bg-card p-6 sm:p-8" @submit.prevent="submit">
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
      <label class="field">
        Mật khẩu (ít nhất {{ CUSTOMER_PASSWORD_MIN_LENGTH }} ký tự)
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
      <label class="flex items-start gap-3 text-sm leading-6">
        <input
          v-model="acceptPrivacyPolicy"
          type="checkbox"
          name="acceptPrivacyPolicy"
          required
          class="mt-1 h-4 w-4 shrink-0 accent-primary"
        />
        <span>
          Tôi đồng ý với
          <NuxtLink :to="`/trang/${PRIVACY_POLICY_SLUG}`" target="_blank" class="link">chính sách bảo mật</NuxtLink>
          về xử lý dữ liệu cá nhân</span
        >
      </label>
      <p v-if="error" role="alert" class="notice-error">{{ error }}</p>
      <button type="submit" class="btn-primary w-full" :disabled="submitting">Đăng ký</button>
    </form>
    <p class="mt-6 text-center text-sm text-muted-foreground">
      Đã có tài khoản? <NuxtLink to="/dang-nhap" class="link">Đăng nhập</NuxtLink>
    </p>
  </main>
</template>
