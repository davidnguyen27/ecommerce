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
  <main>
    <h1>Đăng nhập</h1>
    <form @submit.prevent="submit">
      <label>
        Email
        <input v-model="email" type="email" name="email" autocomplete="username" inputmode="email" required />
      </label>
      <label>
        Mật khẩu
        <input v-model="password" type="password" name="password" autocomplete="current-password" required />
      </label>
      <p v-if="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="submitting">Đăng nhập</button>
    </form>
    <p><NuxtLink to="/quen-mat-khau">Quên mật khẩu?</NuxtLink></p>
    <p>Chưa có tài khoản? <NuxtLink to="/dang-ky">Đăng ký</NuxtLink></p>
  </main>
</template>
