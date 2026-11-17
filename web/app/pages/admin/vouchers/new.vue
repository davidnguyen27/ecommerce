<script setup lang="ts">
import { Voucher, type FieldError, type VoucherCreate } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'voucher.manage' })

const session = useAdminSession()
const error = ref<string | null>(null)
const errors = ref<FieldError[]>([])
const busy = ref(false)

async function create(body: Partial<VoucherCreate>) {
  busy.value = true
  error.value = null
  try {
    const voucher = Voucher.parse(await session.adminFetch('/api/admin/vouchers', { method: 'POST', body }))
    await navigateTo(`/admin/vouchers/${voucher.id}`)
  } catch (err) {
    errors.value = apiFieldErrors(err)
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
        <h1 class="admin-page-title">Tạo mã giảm giá</h1>
        <p class="admin-page-desc">
          Khi mã có lượt dùng đầu tiên, loại, mức giảm, đơn tối thiểu, phạm vi và thời điểm bắt đầu bị khóa. Mã không
          xóa được, chỉ tắt được.
        </p>
      </div>
      <NuxtLink to="/admin/vouchers" class="btn btn-secondary btn-sm">‹ Danh sách mã</NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div class="admin-panel" style="padding: 16px 20px">
      <AdminVoucherForm
        :busy="busy"
        :errors="errors"
        submit-label="Tạo mã"
        @submit="create"
        @cancel="navigateTo('/admin/vouchers')"
      />
    </div>
  </div>
</template>
