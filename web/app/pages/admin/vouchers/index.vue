<script setup lang="ts">
import { VoucherPage, type VoucherQuery } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: ['order.view', 'voucher.manage'] })

const PAGE_SIZE = 50
const STATUSES = [
  { value: 'all', label: 'Tất cả' },
  { value: 'active', label: 'Đang chạy' },
  { value: 'upcoming', label: 'Sắp tới' },
  { value: 'expired', label: 'Hết hạn' },
  { value: 'disabled', label: 'Đã tắt' },
] as const satisfies { value: VoucherQuery['status']; label: string }[]

const session = useAdminSession()
const canManage = computed(() => session.can('voucher.manage'))
const result = ref<VoucherPage | null>(null)
const status = ref<VoucherQuery['status']>('all')
const q = ref('')
const page = ref(1)
const error = ref<string | null>(null)

async function load() {
  error.value = null
  try {
    result.value = VoucherPage.parse(
      await session.adminFetch('/api/admin/vouchers', {
        query: { status: status.value, page: page.value, pageSize: PAGE_SIZE, ...(q.value.trim() && { q: q.value }) },
      }),
    )
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function setStatus(value: VoucherQuery['status']) {
  status.value = value
  page.value = 1
  return load()
}

function search() {
  page.value = 1
  return load()
}

function goTo(target: number) {
  page.value = target
  return load()
}

const lastPage = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / PAGE_SIZE)))

await load()
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Mã giảm giá</h1>
        <p class="admin-page-desc">
          Mã khách gõ khi đặt mua hoặc đặt trước. Mỗi đơn dùng tối đa một mã; giảm vào tiền hàng, không giảm phí giao,
          tối đa 50% tiền hàng thuộc phạm vi.
        </p>
      </div>
      <NuxtLink v-if="canManage" to="/admin/vouchers/new" class="btn btn-primary btn-sm">+ Tạo mã</NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px">
      <div role="group" aria-label="Lọc theo trạng thái" style="display: flex; flex-wrap: wrap; gap: 8px">
        <button
          v-for="s in STATUSES"
          :key="s.value"
          type="button"
          class="btn btn-sm"
          :class="status === s.value ? 'btn-primary' : 'btn-secondary'"
          :aria-pressed="status === s.value"
          @click="setStatus(s.value)"
        >
          {{ s.label }}
        </button>
      </div>
      <form style="display: flex; gap: 8px; margin-left: auto" role="search" @submit.prevent="search">
        <input v-model="q" class="form-input" aria-label="Tìm theo mã" placeholder="Tìm theo mã" maxlength="20" />
        <button type="submit" class="btn btn-secondary btn-sm">Tìm</button>
      </form>
    </div>

    <div class="admin-table-card">
      <div
        v-if="!result || result.items.length === 0"
        style="padding: 40px; text-align: center; color: var(--adm-muted)"
      >
        Chưa có mã giảm giá nào.
      </div>
      <div v-else>
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Trạng thái</th>
                <th>Mức giảm</th>
                <th>Hình thức bán</th>
                <th>Thời hạn</th>
                <th class="admin-table-num">Đã dùng / tổng lượt</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in result.items" :key="v.id">
                <td>
                  <NuxtLink :to="`/admin/vouchers/${v.id}`" style="font-family: var(--adm-mono); font-weight: 600">
                    {{ v.code }}
                  </NuxtLink>
                  <div v-if="v.description" style="font-size: 12px; color: var(--adm-muted)">{{ v.description }}</div>
                </td>
                <td>
                  <span class="badge" :class="VOUCHER_STATUS_BADGES[v.status]">
                    {{ VOUCHER_STATUS_LABELS[v.status] }}
                  </span>
                </td>
                <td style="font-size: 12px">{{ voucherValueLabel(v) }}</td>
                <td style="font-size: 12px">{{ v.saleTypes.map((t) => SALE_TYPE_LABELS[t]).join(', ') }}</td>
                <td style="white-space: nowrap; font-size: 12px">
                  {{ formatDateTime(v.startsAt) }} – {{ formatDateTime(v.endsAt) }}
                </td>
                <td class="admin-table-num">{{ v.used }} / {{ v.totalLimit ?? '∞' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            border-top: 1px solid var(--adm-border);
          "
        >
          <div style="font-size: 12px; color: var(--adm-muted)">
            Trang <strong>{{ page }}</strong> / <strong>{{ lastPage }}</strong> ({{ result.total }} mã)
          </div>
          <div style="display: flex; gap: 8px">
            <button type="button" class="btn btn-secondary btn-sm" :disabled="page <= 1" @click="goTo(page - 1)">
              ‹ Trang trước
            </button>
            <button type="button" class="btn btn-secondary btn-sm" :disabled="page >= lastPage" @click="goTo(page + 1)">
              Trang sau ›
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
