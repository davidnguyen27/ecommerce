<script setup lang="ts">
import { AdminOrderPage, type AdminOrderQuery } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'order.view' })

const PAGE_SIZE = 50

type Filters = Pick<AdminOrderQuery, 'status' | 'paymentStatus' | 'fulfillmentStatus' | 'sort'> & { q: string }
// Mặc định giống API: hàng chờ soạn, đơn cũ trước để soạn theo thứ tự đặt.
const TO_PREPARE: Filters = {
  status: 'processing',
  paymentStatus: 'paid',
  fulfillmentStatus: 'not_prepared',
  sort: 'oldest',
  q: '',
}
const ALL: Filters = { status: 'all', paymentStatus: 'all', fulfillmentStatus: 'all', sort: 'newest', q: '' }

const session = useAdminSession()
const result = ref<AdminOrderPage | null>(null)
const error = ref<string | null>(null)
const filters = reactive<Filters>({ ...TO_PREPARE })
const page = ref(1)

async function load() {
  error.value = null
  try {
    result.value = AdminOrderPage.parse(
      await session.adminFetch('/api/admin/orders', {
        query: { ...filters, q: filters.q.trim() || undefined, page: page.value, pageSize: PAGE_SIZE },
      }),
    )
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function search() {
  page.value = 1
  return load()
}

function preset(values: Filters) {
  Object.assign(filters, values)
  return search()
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
        <h1 class="admin-page-title">Đơn hàng</h1>
        <p class="admin-page-desc">
          Mặc định là hàng chờ soạn: đơn đã trả đủ, chưa chuẩn bị, đơn cũ trước. Tìm theo mã đơn, số điện thoại hoặc
          email.
        </p>
      </div>
      <div style="display: flex; gap: 8px">
        <button type="button" class="btn btn-secondary btn-sm" @click="preset(TO_PREPARE)">Hàng chờ soạn</button>
        <button type="button" class="btn btn-secondary btn-sm" @click="preset(ALL)">Mọi đơn</button>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <form @submit.prevent="search">
        <div
          style="
            display: grid;
            grid-template-columns: minmax(220px, 2fr) repeat(auto-fit, minmax(150px, 1fr)) 100px;
            gap: 12px;
            align-items: end;
          "
        >
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="orders-q" style="font-size: 12px">Mã đơn, số điện thoại, email</label>
            <input id="orders-q" v-model="filters.q" type="search" class="form-input" maxlength="200" />
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="orders-status" style="font-size: 12px">Trạng thái đơn</label>
            <select id="orders-status" v-model="filters.status" class="form-select">
              <option value="all">Tất cả</option>
              <option v-for="(label, value) in ORDER_STATUS_LABELS" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="orders-payment" style="font-size: 12px">Thanh toán</label>
            <select id="orders-payment" v-model="filters.paymentStatus" class="form-select">
              <option value="all">Tất cả</option>
              <option v-for="(label, value) in PAYMENT_STATUS_LABELS" :key="value" :value="value">{{ label }}</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="orders-fulfillment" style="font-size: 12px">Giao hàng</label>
            <select id="orders-fulfillment" v-model="filters.fulfillmentStatus" class="form-select">
              <option value="all">Tất cả</option>
              <option v-for="(label, value) in FULFILLMENT_STATUS_LABELS" :key="value" :value="value">
                {{ label }}
              </option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom: 0">
            <label class="form-label" for="orders-sort" style="font-size: 12px">Thứ tự</label>
            <select id="orders-sort" v-model="filters.sort" class="form-select">
              <option value="oldest">Cũ trước</option>
              <option value="newest">Mới trước</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Lọc</button>
        </div>
      </form>
    </div>

    <div class="admin-table-card">
      <div
        v-if="!result || result.items.length === 0"
        style="padding: 40px; text-align: center; color: var(--adm-muted)"
      >
        Không có đơn nào khớp bộ lọc.
      </div>
      <div v-else>
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Đặt lúc</th>
                <th>Người nhận</th>
                <th>Tỉnh/thành</th>
                <th class="admin-table-num">Số món</th>
                <th class="admin-table-num">Tổng tiền</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in result.items" :key="o.code" data-testid="admin-order-row">
                <td>
                  <NuxtLink :to="`/admin/orders/${o.code}`" style="font-family: var(--adm-mono); font-weight: 600">
                    #{{ o.code }}
                  </NuxtLink>
                </td>
                <td style="white-space: nowrap">{{ formatDateTime(o.createdAt) }}</td>
                <td>
                  <div>{{ o.recipientName }}</div>
                  <div style="font-size: 12px; color: var(--adm-muted)">{{ o.phone }} · {{ o.email }}</div>
                </td>
                <td>{{ o.provinceName }}</td>
                <td class="admin-table-num">{{ o.itemCount }}</td>
                <td class="admin-table-num">{{ formatVnd(o.total) }}</td>
                <td style="font-size: 12px">
                  <div>{{ ORDER_STATUS_LABELS[o.status] }}</div>
                  <div style="color: var(--adm-muted)">
                    {{ PAYMENT_STATUS_LABELS[o.paymentStatus] }} · {{ FULFILLMENT_STATUS_LABELS[o.fulfillmentStatus] }}
                  </div>
                </td>
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
            Trang <strong>{{ page }}</strong> / <strong>{{ lastPage }}</strong> ({{ result.total }} đơn)
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
