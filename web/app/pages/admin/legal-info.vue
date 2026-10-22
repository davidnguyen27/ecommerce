<script setup lang="ts">
import { LegalInfo } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'content.edit' })

const FIELDS: { key: keyof LegalInfo; label: string; type?: string }[] = [
  { key: 'companyName', label: 'Tên doanh nghiệp' },
  { key: 'businessRegistrationNumber', label: 'Mã số doanh nghiệp' },
  { key: 'businessRegistrationIssuedOn', label: 'Ngày cấp', type: 'date' },
  { key: 'businessRegistrationIssuedBy', label: 'Nơi cấp' },
  { key: 'address', label: 'Địa chỉ trụ sở' },
  { key: 'phone', label: 'Điện thoại', type: 'tel' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'moitLogoUrl', label: 'Đường dẫn ảnh logo "Đã thông báo Bộ Công Thương"', type: 'url' },
  { key: 'moitNoticeUrl', label: 'Đường dẫn hồ sơ thông báo trên online.gov.vn', type: 'url' },
]

const session = useAdminSession()
const form = ref<LegalInfo>(LegalInfo.parse(await session.adminFetch('/api/admin/legal-info')))
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

async function save() {
  error.value = null
  notice.value = null
  try {
    form.value = LegalInfo.parse(await session.adminFetch('/api/admin/legal-info', { method: 'PUT', body: form.value }))
    notice.value = 'Đã lưu; chân trang website hiển thị thông tin mới'
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}
</script>

<template>
  <main>
    <h1>Thông tin pháp lý</h1>
    <p>Hiển thị ở chân trang mọi trang của website.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <form @submit.prevent="save">
      <label v-for="field in FIELDS" :key="field.key">
        {{ field.label }}
        <input v-model="form[field.key]" :type="field.type ?? 'text'" />
      </label>
      <img v-if="form.moitLogoUrl" :src="form.moitLogoUrl" alt="Xem trước logo" width="150" />
      <button type="submit">Lưu</button>
    </form>
  </main>
</template>
