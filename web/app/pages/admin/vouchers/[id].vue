<script setup lang="ts">
import { Voucher, VoucherOrderPage, type FieldError, type VoucherCreate } from '@ecommerce/shared'

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

const canOpen = session.canOpen

const ORDERS_PAGE_SIZE = 20
const orders = ref<VoucherOrderPage | null>(null)
const ordersPage = ref(1)
const ordersLastPage = computed(() => Math.max(1, Math.ceil((orders.value?.total ?? 0) / ORDERS_PAGE_SIZE)))
async function loadOrders(target = ordersPage.value) {
  try {
    orders.value = VoucherOrderPage.parse(
      await session.adminFetch(`${url}/orders`, { query: { page: target, pageSize: ORDERS_PAGE_SIZE } }),
    )
    ordersPage.value = target
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

try {
  voucher.value = Voucher.parse(await session.adminFetch(url))
  await loadOrders(1)
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
    <template v-if="voucher && orders">
      <div style="display: flex; align-items: baseline; justify-content: space-between; margin-top: 24px">
        <h2 class="admin-section-title">Đơn đã dùng mã</h2>
        <NuxtLink
          v-if="canOpen('/admin/orders') && orders.total > 0"
          :to="{ path: '/admin/orders', query: { voucherCode: voucher.code } }"
          style="font-size: 13px"
        >
          Lọc ở danh sách đơn
        </NuxtLink>
      </div>
      <div class="admin-table-card">
        <div v-if="orders.items.length === 0" style="padding: 32px; text-align: center; color: var(--adm-muted)">
          Chưa có đơn nào dùng mã này.
        </div>
        <div v-else style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Khách</th>
                <th>Trạng thái</th>
                <th class="admin-table-num">Tiền giảm</th>
                <th class="admin-table-num">Tổng</th>
                <th>Lúc đặt</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in orders.items" :key="o.code" data-testid="voucher-order">
                <td>
                  <NuxtLink v-if="canOpen('/admin/orders')" :to="`/admin/orders/${o.code}`" style="font-weight: 600">
                    #{{ o.code }}
                  </NuxtLink>
                  <span v-else style="font-weight: 600">#{{ o.code }}</span>
                  <div v-if="o.kind === 'preorder'" style="font-size: 12px; color: var(--adm-muted)">Đặt trước</div>
                </td>
                <td style="font-size: 12px">
                  {{ o.recipientName }}
                  <div style="color: var(--adm-muted)">{{ o.email }}</div>
                </td>
                <td style="font-size: 12px">
                  {{ ORDER_STATUS_LABELS[o.status] }} · {{ PAYMENT_STATUS_LABELS[o.paymentStatus] }}
                  <div v-if="!o.counted" style="color: var(--adm-muted)">Không tính lượt</div>
                </td>
                <td class="admin-table-num">{{ formatVnd(o.discount) }}</td>
                <td class="admin-table-num">{{ formatVnd(o.total) }}</td>
                <td style="white-space: nowrap; font-size: 12px">{{ formatDateTime(o.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div
          v-if="ordersLastPage > 1"
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 18px;
            border-top: 1px solid var(--adm-border);
          "
        >
          <div style="font-size: 12px; color: var(--adm-muted)">
            Trang <strong>{{ ordersPage }}</strong> / <strong>{{ ordersLastPage }}</strong> ({{ orders.total }} đơn)
          </div>
          <div style="display: flex; gap: 8px">
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="ordersPage <= 1"
              @click="loadOrders(ordersPage - 1)"
            >
              ‹ Trang trước
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-sm"
              :disabled="ordersPage >= ordersLastPage"
              @click="loadOrders(ordersPage + 1)"
            >
              Trang sau ›
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
