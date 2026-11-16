<script setup lang="ts">
import { Voucher, type FieldError, type VoucherCreate } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: ['order.view', 'voucher.manage'] })

const session = useAdminSession()
const route = useRoute()
const canManage = computed(() => session.can('voucher.manage'))
const voucher = ref<Voucher | null>(null)
const editing = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const errors = ref<FieldError[]>([])
const url = `/api/admin/vouchers/${String(route.params.id)}`

try {
  voucher.value = Voucher.parse(await session.adminFetch(url))
} catch (err) {
  error.value = apiErrorMessage(err)
}

function startEditing() {
  editing.value = true
  errors.value = []
  notice.value = null
}

async function save(body: Partial<VoucherCreate>) {
  busy.value = true
  error.value = null
  try {
    voucher.value = Voucher.parse(await session.adminFetch(url, { method: 'PATCH', body }))
    editing.value = false
    notice.value = 'Đã lưu mã giảm giá'
  } catch (err) {
    errors.value = apiFieldErrors(err)
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}

async function disable() {
  if (!voucher.value) return
  if (
    !confirm(
      `Tắt mã ${voucher.value.code}? Đơn đã đặt vẫn giữ phần giảm, nhưng không đơn mới nào dùng được, và không bật lại được.`,
    )
  )
    return
  busy.value = true
  error.value = null
  try {
    voucher.value = Voucher.parse(await session.adminFetch(`${url}/disable`, { method: 'POST' }))
    notice.value = 'Đã tắt mã'
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
        <h1 class="admin-page-title">
          Mã giảm giá<template v-if="voucher">
            · <span style="font-family: var(--adm-mono)">{{ voucher.code }}</span></template
          >
        </h1>
        <p v-if="voucher" class="admin-page-desc">
          Tạo bởi {{ voucher.createdBy.name }} lúc {{ formatDateTime(voucher.createdAt) }}
          <template v-if="voucher.disabledAt"> · tắt lúc {{ formatDateTime(voucher.disabledAt) }}</template>
        </p>
      </div>
      <div style="display: flex; gap: 8px">
        <button
          v-if="canManage && voucher && voucher.status !== 'disabled' && !editing"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="startEditing"
        >
          Sửa mã
        </button>
        <button
          v-if="canManage && voucher && voucher.status !== 'disabled' && !editing"
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="busy"
          @click="disable"
        >
          Tắt mã
        </button>
        <NuxtLink to="/admin/vouchers" class="btn btn-secondary btn-sm">‹ Danh sách mã</NuxtLink>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>
    <div v-if="notice" class="admin-alert admin-alert-success" role="status">
      <span>{{ notice }}</span>
    </div>

    <div v-if="voucher && editing" class="admin-panel" style="padding: 16px 20px">
      <AdminVoucherForm
        :voucher="voucher"
        :busy="busy"
        :errors="errors"
        submit-label="Lưu"
        @submit="save"
        @cancel="editing = false"
      />
    </div>

    <div v-else-if="voucher" class="admin-panel" style="padding: 16px 20px">
      <dl style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 0">
        <div>
          <dt class="form-label">Trạng thái</dt>
          <dd>
            <span class="badge" :class="VOUCHER_STATUS_BADGES[voucher.status]">
              {{ VOUCHER_STATUS_LABELS[voucher.status] }}
            </span>
          </dd>
        </div>
        <div>
          <dt class="form-label">Mức giảm</dt>
          <dd>{{ voucherValueLabel(voucher) }}</dd>
        </div>
        <div>
          <dt class="form-label">Đơn tối thiểu</dt>
          <dd>{{ voucher.minSubtotal ? formatVnd(voucher.minSubtotal) : 'Không có' }}</dd>
        </div>
        <div>
          <dt class="form-label">Thời hạn</dt>
          <dd>{{ formatDateTime(voucher.startsAt) }} – {{ formatDateTime(voucher.endsAt) }}</dd>
        </div>
        <div>
          <dt class="form-label">Hình thức bán</dt>
          <dd>{{ voucher.saleTypes.map((t) => SALE_TYPE_LABELS[t]).join(', ') }}</dd>
        </div>
        <div>
          <dt class="form-label">Đã dùng / tổng lượt</dt>
          <dd>{{ voucher.used }} / {{ voucher.totalLimit ?? 'không giới hạn' }}</dd>
        </div>
        <div>
          <dt class="form-label">Lượt mỗi khách</dt>
          <dd>{{ voucher.perCustomerLimit }}</dd>
        </div>
        <div>
          <dt class="form-label">Thương hiệu</dt>
          <dd>{{ voucher.brands.length ? voucher.brands.map((b) => b.name).join(', ') : 'Mọi thương hiệu' }}</dd>
        </div>
        <div>
          <dt class="form-label">Danh mục (gồm danh mục con)</dt>
          <dd>{{ voucher.categories.length ? voucher.categories.map((c) => c.name).join(', ') : 'Mọi danh mục' }}</dd>
        </div>
        <div v-if="voucher.description" style="grid-column: 1 / -1">
          <dt class="form-label">Ghi chú nội bộ</dt>
          <dd>{{ voucher.description }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>
