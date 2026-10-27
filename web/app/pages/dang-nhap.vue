<script setup lang="ts">
const session = useCustomerSession()
const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

async function submit() {
  submitting.value = true
  error.value = null
  try {
    await session.login(email.value, password.value)
    await navigateTo('/tai-khoan')
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    submitting.value = false
  }
}

// Trang riêng của từng khách, không có nội dung để index.
useSeo({ title: 'Đăng nhập', description: 'Đăng nhập tài khoản khách hàng.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-md px-4 py-12 sm:py-20">
    <h1>Đăng nhập</h1>
    <p class="mt-2 text-sm text-muted-foreground">Chào mừng bạn quay lại.</p>
    <form class="mt-8 space-y-5 rounded-lg border border-border bg-card p-6 sm:p-8" @submit.prevent="submit">
      <label class="field">
        Email
        <input
          class="field-input"
          v-model="email"
          type="email"
          name="email"
          autocomplete="username"
          inputmode="email"
          required
        />
      </label>
      <label class="field">
        Mật khẩu
        <input
          class="field-input"
          v-model="password"
          type="password"
          name="password"
          autocomplete="current-password"
          required
        />
      </label>
      <p v-if="error" role="alert" class="notice-error">{{ error }}</p>
      <p class="-mt-1 text-right text-sm"><NuxtLink to="/quen-mat-khau" class="link">Quên mật khẩu?</NuxtLink></p>
      <button type="submit" class="btn-primary w-full" :disabled="submitting">Đăng nhập</button>
    </form>
    <p class="mt-6 text-center text-sm text-muted-foreground">
      Chưa có tài khoản? <NuxtLink to="/dang-ky" class="link">Đăng ký</NuxtLink>
    </p>
  </main>
</template>
