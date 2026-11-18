<script setup lang="ts">
import { ReturnWindowList, type ReturnWindowItem } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'content.edit' })

/**
 * Hạn đổi trả theo nhóm hàng (GLOSSARY): số ngày tính từ lúc giao. Chỉ để cảnh báo nhân viên khi khách gửi yêu cầu trả
 * hay đổi đã quá hạn; không chặn khách. Để trống là không cảnh báo nhóm đó.
 */
const session = useAdminSession()
const rows = ref<{ productType: ReturnWindowItem['productType']; days: string }[]>([])
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

function setItems(items: ReturnWindowItem[]) {
  rows.value = items.map((i) => ({ productType: i.productType, days: i.days === null ? '' : String(i.days) }))
}

async function load() {
  try {
    setItems(ReturnWindowList.parse(await session.adminFetch('/api/admin/return-windows')).items)
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

async function save() {
  busy.value = true
  error.value = null
  notice.value = null
  try {
    const items = rows.value.map((r) => ({
      productType: r.productType,
      days: r.days.trim() === '' ? null : Number(r.days),
    }))
    setItems(
      ReturnWindowList.parse(await session.adminFetch('/api/admin/return-windows', { method: 'PUT', body: { items } }))
        .items,
    )
    notice.value = 'Đã lưu hạn đổi trả'
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}

await load()
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Hạn đổi trả</h1>
        <p class="admin-page-desc">
          Số ngày khách được trả hay đổi hàng, tính từ lúc giao. Quá hạn thì nhân viên được cảnh báo ở yêu cầu, khách
          vẫn gửi được. Để trống là không cảnh báo. Nhớ ghi cùng số ngày trong trang chính sách đổi trả.
        </p>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>
    <div v-if="notice" class="admin-alert admin-alert-success" role="status">
      <span>{{ notice }}</span>
    </div>

    <form class="admin-panel" style="max-width: 520px" @submit.prevent="save">
      <div v-for="row in rows" :key="row.productType" class="form-group">
        <label class="form-label" :for="`window-${row.productType}`">{{ PRODUCT_TYPE_LABELS[row.productType] }}</label>
        <input
          :id="`window-${row.productType}`"
          v-model="row.days"
          type="number"
          min="0"
          max="365"
          class="form-input"
          placeholder="Không cảnh báo"
          :data-testid="`return-window-${row.productType}`"
        />
      </div>
      <button type="submit" class="btn btn-primary btn-sm" :disabled="busy">Lưu</button>
    </form>
  </div>
</template>
