<script setup lang="ts">
import '~/assets/admin.css'

// Màn hình đăng nhập toàn trang; không dùng layout website lẫn layout admin (layout admin cần phiên).
definePageMeta({ layout: false })

const session = useAdminSession()
const email = ref('')
const password = ref('')
const error = ref<string | null>(null)
const submitting = ref(false)

async function submit() {
  submitting.value = true
  error.value = null
  try {
    await session.login(email.value, password.value)
    await navigateTo('/admin')
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="admin-shell" style="align-items: center; justify-content: center; background: #0a0c0f; padding: 24px">
    <div
      style="
        width: 100%;
        max-width: 420px;
        background: #12151b;
        border: 1px solid #1e232d;
        border-radius: 10px;
        padding: 36px 32px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      "
    >
      <div style="text-align: center; margin-bottom: 28px">
        <div
          style="
            width: 44px;
            height: 44px;
            background: #ffffff;
            color: #0a0c0f;
            border-radius: 8px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            font-size: 20px;
            margin-bottom: 12px;
          "
        >
          A
        </div>
        <h1
          style="
            color: #ffffff;
            font-size: 18px;
            font-weight: 700;
            letter-spacing: 0.08em;
            margin: 0;
            text-transform: uppercase;
          "
        >
          ATELIER COMMERCE
        </h1>
        <p style="color: #8e96a4; font-size: 12px; margin: 6px 0 0 0; letter-spacing: 0.02em">
          Cổng Đăng Nhập Quản Trị Hệ Thống
        </p>
      </div>

      <div
        v-if="error"
        class="admin-alert admin-alert-danger"
        role="alert"
        style="margin-bottom: 20px; font-size: 13px"
      >
        <span>{{ error }}</span>
      </div>

      <form @submit.prevent="submit">
        <div class="form-group" style="margin-bottom: 16px">
          <label class="form-label" for="login-email" style="color: #d1d5db">Địa chỉ Email nhân sự</label>
          <input
            id="login-email"
            v-model="email"
            type="email"
            class="form-input"
            style="background: #1a1e26; border-color: #2d3340; color: #ffffff"
            autocomplete="username"
            placeholder="nhanvien@shop.vn"
            required
          />
        </div>

        <div class="form-group" style="margin-bottom: 24px">
          <label class="form-label" for="login-password" style="color: #d1d5db">Mật khẩu xác thực</label>
          <input
            id="login-password"
            v-model="password"
            type="password"
            class="form-input"
            style="background: #1a1e26; border-color: #2d3340; color: #ffffff"
            autocomplete="current-password"
            placeholder="••••••••••••"
            required
          />
        </div>

        <button
          type="submit"
          class="btn btn-primary"
          style="
            width: 100%;
            justify-content: center;
            background: #ffffff;
            color: #0a0c0f;
            font-weight: 600;
            padding: 10px 16px;
          "
          :disabled="submitting"
        >
          <span v-if="submitting">Đang xác thực...</span>
          <span v-else>Đăng nhập quản trị ›</span>
        </button>
      </form>

      <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #1e232d; text-align: center">
        <p style="color: #6b7280; font-size: 11px; margin: 0; line-height: 1.4">
          Hệ thống bảo mật nội bộ. Mọi phiên đăng nhập và thao tác nghiệp vụ đều được ghi nhận trong nhật ký kiểm toán.
        </p>
      </div>
    </div>
  </div>
</template>
