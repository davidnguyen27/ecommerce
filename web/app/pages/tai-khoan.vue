<script setup lang="ts">
import { CUSTOMER_PASSWORD_MIN_LENGTH, type CustomerProfile } from '@ecommerce/shared'

// Phiên khách chỉ có ở trình duyệt nên trang này nạp dữ liệu sau khi mount, không qua SSR.
const session = useCustomerSession()
const profile = ref<CustomerProfile | null>(null)
const notice = ref<string | null>(null)
const sending = ref(false)

onMounted(async () => {
  try {
    profile.value = await session.loadProfile()
  } catch {
    await navigateTo('/dang-nhap')
  }
})

async function resendVerification() {
  sending.value = true
  notice.value = null
  try {
    await session.accountFetch('/api/account/email-verification', { method: 'POST' })
    notice.value = 'Đã gửi lại thư xác minh, hãy kiểm tra hộp thư của bạn.'
  } catch (err) {
    notice.value = apiErrorMessage(err)
  } finally {
    sending.value = false
  }
}

const currentPassword = ref('')
const newPassword = ref('')
const passwordNotice = ref<string | null>(null)
const changing = ref(false)

async function changePassword() {
  changing.value = true
  passwordNotice.value = null
  try {
    await session.changePassword({ currentPassword: currentPassword.value, newPassword: newPassword.value })
    currentPassword.value = ''
    newPassword.value = ''
    passwordNotice.value = 'Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.'
  } catch (err) {
    passwordNotice.value = apiErrorMessage(err)
  } finally {
    changing.value = false
  }
}

const consentedOn = computed(() =>
  profile.value
    ? new Date(profile.value.privacyConsent.consentedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : '',
)

// Trang riêng của từng khách, không có nội dung để index.
useSeo({ title: 'Tài khoản', description: 'Thông tin tài khoản khách hàng.', noindex: true })
</script>

<template>
  <main>
    <h1>Tài khoản</h1>
    <p v-if="!profile">Đang tải…</p>
    <template v-else>
      <p>Email: {{ profile.email }}</p>
      <p v-if="profile.emailVerified">Email đã xác minh.</p>
      <p v-else>
        Email chưa xác minh.
        <button type="button" :disabled="sending" @click="resendVerification">Gửi lại thư xác minh</button>
      </p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p>
        <small>
          Bạn đã đồng ý với chính sách bảo mật phiên bản {{ profile.privacyConsent.policyVersion }} lúc
          {{ consentedOn }}.
        </small>
      </p>
      <form @submit.prevent="changePassword">
        <h2>Đổi mật khẩu</h2>
        <label>
          Mật khẩu hiện tại
          <input
            v-model="currentPassword"
            type="password"
            name="currentPassword"
            autocomplete="current-password"
            required
          />
        </label>
        <label>
          Mật khẩu mới (ít nhất {{ CUSTOMER_PASSWORD_MIN_LENGTH }} ký tự)
          <input
            v-model="newPassword"
            type="password"
            name="newPassword"
            autocomplete="new-password"
            :minlength="CUSTOMER_PASSWORD_MIN_LENGTH"
            required
          />
        </label>
        <p v-if="passwordNotice" role="status">{{ passwordNotice }}</p>
        <button type="submit" :disabled="changing">Đổi mật khẩu</button>
      </form>
      <button type="button" @click="session.logout()">Đăng xuất</button>
    </template>
  </main>
</template>
