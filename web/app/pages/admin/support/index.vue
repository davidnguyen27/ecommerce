<script setup lang="ts">
import { AdminSupportPage, type AdminSupportQuery } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: ['support.handle', 'order.view'] })

const PAGE_SIZE = 50

const session = useAdminSession()
const route = useRoute()
const result = ref<AdminSupportPage | null>(null)
const error = ref<string | null>(null)
// Bảng điều khiển mở trang với `?unassigned=true` hay `?status=awaiting_staff`.
const filters = reactive({
  status: (typeof route.query.status === 'string' ? route.query.status : 'open') as NonNullable<
    AdminSupportQuery['status']
  >,
  kind: 'all' as NonNullable<AdminSupportQuery['kind']>,
  mine: false,
  unassigned: route.query.unassigned === 'true',
  exchangeOverdue: route.query.exchangeOverdue === 'true',
  returnOverdue: route.query.returnOverdue === 'true',
})
const page = ref(1)

async function load() {
  error.value = null
  try {
    result.value = AdminSupportPage.parse(
      await session.adminFetch('/api/admin/support-requests', {
        query: {
          status: filters.status,
          kind: filters.kind,
          assignee: filters.mine ? 'me' : undefined,
          unassigned: filters.unassigned ? 'true' : undefined,
          exchangeOverdue: filters.exchangeOverdue ? 'true' : undefined,
          returnOverdue: filters.returnOverdue ? 'true' : undefined,
          page: page.value,
          pageSize: PAGE_SIZE,
        },
      }),
    )
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function filter() {
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
        <h1 class="admin-page-title">Yêu cầu hỗ trợ</h1>
        <p class="admin-page-desc">Việc khách nhờ cửa hàng xử lý. Yêu cầu cũ trước: khách chờ lâu nhất ở trên cùng.</p>
      </div>
      <NuxtLink v-if="session.canOpen('/admin/support/new')" to="/admin/support/new" class="btn btn-primary btn-sm">
        Tạo hộ khách
      </NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: end">
        <div class="form-group" style="margin-bottom: 0; min-width: 180px">
          <label class="form-label" for="support-status" style="font-size: 12px">Trạng thái</label>
          <select id="support-status" v-model="filters.status" class="form-select" @change="filter">
            <option value="open">Chưa kết thúc</option>
            <option value="awaiting_staff">Chờ nhân viên</option>
            <option v-for="(label, value) in SUPPORT_STATUS_LABELS" :key="value" :value="value">{{ label }}</option>
            <option value="all">Tất cả</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom: 0; min-width: 160px">
          <label class="form-label" for="support-kind" style="font-size: 12px">Loại</label>
          <select id="support-kind" v-model="filters.kind" class="form-select" @change="filter">
            <option value="all">Tất cả</option>
            <option v-for="(label, value) in SUPPORT_KIND_LABELS" :key="value" :value="value">{{ label }}</option>
          </select>
        </div>
        <label style="display: flex; gap: 6px; align-items: center; font-size: 13px">
          <input v-model="filters.unassigned" type="checkbox" data-testid="support-unassigned" @change="filter" />
          Chưa ai nhận
        </label>
        <label style="display: flex; gap: 6px; align-items: center; font-size: 13px">
          <input v-model="filters.mine" type="checkbox" @change="filter" />
          Của tôi
        </label>
        <label style="display: flex; gap: 6px; align-items: center; font-size: 13px">
          <input
            v-model="filters.exchangeOverdue"
            type="checkbox"
            data-testid="support-exchange-overdue"
            @change="filter"
          />
          Đổi hàng quá hạn gửi
        </label>
        <label style="display: flex; gap: 6px; align-items: center; font-size: 13px">
          <input v-model="filters.returnOverdue" type="checkbox" @change="filter" />
          Gửi khi đã quá hạn đổi trả
        </label>
      </div>
    </div>

    <div class="admin-table-card">
      <div
        v-if="!result || result.items.length === 0"
        style="padding: 40px; text-align: center; color: var(--adm-muted)"
      >
        Không có yêu cầu nào.
      </div>
      <div v-else>
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Yêu cầu</th>
                <th>Loại</th>
                <th>Khách</th>
                <th>Đơn</th>
                <th>Trạng thái</th>
                <th>Người phụ trách</th>
                <th>Tin cuối</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in result.items" :key="item.code" data-testid="support-row">
                <td>
                  <NuxtLink :to="`/admin/support/${item.code}`" style="font-family: var(--adm-mono); font-weight: 600">
                    #YC{{ item.code }}
                  </NuxtLink>
                  <div style="font-size: 12px">{{ item.subject }}</div>
                </td>
                <td>{{ SUPPORT_KIND_LABELS[item.kind] }}</td>
                <td style="font-size: 12px">
                  <div>{{ item.contactName ?? '—' }}</div>
                  <div style="color: var(--adm-muted)">{{ item.contactEmail }}</div>
                </td>
                <td>
                  <NuxtLink v-if="item.orderCode" :to="`/admin/orders/${item.orderCode}`"
                    >#{{ item.orderCode }}</NuxtLink
                  >
                  <span v-else style="color: var(--adm-muted)">—</span>
                </td>
                <td>{{ SUPPORT_STATUS_LABELS[item.status] }}</td>
                <td style="font-size: 12px">{{ item.assignee?.name ?? 'Chưa ai nhận' }}</td>
                <td style="white-space: nowrap; font-size: 12px">{{ formatDateTime(item.lastMessageAt) }}</td>
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
            Trang <strong>{{ page }}</strong> / <strong>{{ lastPage }}</strong> ({{ result.total }} yêu cầu)
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
