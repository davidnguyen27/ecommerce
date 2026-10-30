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

const consentedOn = computed(() => (profile.value ? formatDateTime(profile.value.privacyConsent.consentedAt) : ''))

// Trang riêng của từng khách, không có nội dung để index.
useSeo({ title: 'Tài khoản', description: 'Thông tin tài khoản khách hàng.', noindex: true })
</script>

<template>
  <main class="mx-auto max-w-2xl px-4 py-12 sm:py-16">
    <h1>Tài khoản</h1>
    <p v-if="!profile" class="mt-8 text-muted-foreground">Đang tải…</p>
    <template v-else>
      <section class="mt-8 rounded-lg border border-border bg-card p-6 sm:p-8">
        <h2>Thông tin đăng nhập</h2>
        <dl class="mt-4 text-sm">
          <dt class="text-muted-foreground">Email</dt>
          <dd class="mt-1 flex flex-wrap items-center gap-2 font-medium">
            {{ profile.email }}
            <span
              v-if="profile.emailVerified"
              class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800"
              >Email đã xác minh.</span
            >
            <span v-else class="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900"
              >Email chưa xác minh.</span
            >
          </dd>
        </dl>
        <button
          v-if="!profile.emailVerified"
          type="button"
          class="btn-outline mt-4"
          :disabled="sending"
          @click="resendVerification"
        >
          Gửi lại thư xác minh
        </button>
        <p v-if="notice" role="status" class="mt-4 text-sm">{{ notice }}</p>
        <p class="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
          Bạn đã đồng ý với chính sách bảo mật phiên bản {{ profile.privacyConsent.policyVersion }} lúc
          {{ consentedOn }}.
        </p>
      </section>
      <form class="mt-6 space-y-5 rounded-lg border border-border bg-card p-6 sm:p-8" @submit.prevent="changePassword">
        <h2>Đổi mật khẩu</h2>
        <label class="field">
          Mật khẩu hiện tại
          <input
            class="field-input"
            v-model="currentPassword"
            type="password"
            name="currentPassword"
            autocomplete="current-password"
            required
          />
        </label>
        <label class="field">
          Mật khẩu mới (ít nhất {{ CUSTOMER_PASSWORD_MIN_LENGTH }} ký tự)
          <input
            class="field-input"
            v-model="newPassword"
            type="password"
            name="newPassword"
            autocomplete="new-password"
            :minlength="CUSTOMER_PASSWORD_MIN_LENGTH"
            required
          />
        </label>
        <p v-if="passwordNotice" role="status" class="text-sm">{{ passwordNotice }}</p>
        <button type="submit" class="btn-primary" :disabled="changing">Đổi mật khẩu</button>
      </form>
      <button type="button" class="btn-outline mt-6" @click="session.logout()">Đăng xuất</button>
    </template>
  </main>
</template>
