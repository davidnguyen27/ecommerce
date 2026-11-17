<script setup lang="ts">
import { AdminSupportRequest } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'support.handle' })

/** Nhân viên tạo yêu cầu thay cho khách gọi điện hay nhắn tin: gắn với một đơn, hoặc với tài khoản khách theo email. */
const session = useAdminSession()
const route = useRoute()
const form = reactive({
  orderCode: typeof route.query.orderCode === 'string' ? route.query.orderCode : '',
  customerEmail: '',
  subject: '',
  message: '',
})
const busy = ref(false)
const error = ref<string | null>(null)

async function submit() {
  busy.value = true
  error.value = null
  try {
    const created = AdminSupportRequest.parse(
      await session.adminFetch('/api/admin/support-requests', {
        method: 'POST',
        body: {
          kind: 'other',
          orderCode: form.orderCode.trim() ? Number(form.orderCode) : undefined,
          customerEmail: form.orderCode.trim() ? undefined : form.customerEmail.trim() || undefined,
          subject: form.subject,
          message: form.message,
        },
      }),
    )
    await navigateTo(`/admin/support/${created.code}`)
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Tạo yêu cầu hộ khách</h1>
        <p class="admin-page-desc">Khách nhận email kèm link để theo dõi và trả lời yêu cầu.</p>
      </div>
      <NuxtLink to="/admin/support" class="btn btn-secondary btn-sm">‹ Danh sách yêu cầu</NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <form class="admin-panel" style="max-width: 640px" @submit.prevent="submit">
      <div class="form-group">
        <label class="form-label" for="support-new-order">Mã đơn</label>
        <input id="support-new-order" v-model="form.orderCode" class="form-input" inputmode="numeric" />
        <div class="form-help">Bỏ trống nếu yêu cầu không gắn đơn; khi đó cần email tài khoản khách.</div>
      </div>
      <div v-if="!form.orderCode.trim()" class="form-group">
        <label class="form-label" for="support-new-email">Email tài khoản khách</label>
        <input id="support-new-email" v-model="form.customerEmail" type="email" class="form-input" />
      </div>
      <div class="form-group">
        <label class="form-label" for="support-new-subject">Tiêu đề</label>
        <input id="support-new-subject" v-model="form.subject" class="form-input" maxlength="200" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="support-new-message">Nội dung khách nhờ</label>
        <textarea
          id="support-new-message"
          v-model="form.message"
          class="form-textarea"
          rows="5"
          maxlength="5000"
          required
        />
      </div>
      <button type="submit" class="btn btn-primary btn-sm" :disabled="busy">Tạo yêu cầu</button>
    </form>
  </div>
</template>
