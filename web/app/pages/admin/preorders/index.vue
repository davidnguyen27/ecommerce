<script setup lang="ts">
import { PreorderCampaignPage } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: ['order.view', 'preorder.manage'] })

const PAGE_SIZE = 50
const STATES = [
  { value: 'all', label: 'Tất cả' },
  { value: 'open', label: 'Đang mở' },
  { value: 'closed', label: 'Đã đóng' },
] as const

const session = useAdminSession()
const canManage = computed(() => session.can('preorder.manage'))
const result = ref<PreorderCampaignPage | null>(null)
const state = ref<(typeof STATES)[number]['value']>('all')
const page = ref(1)
const error = ref<string | null>(null)

async function load() {
  error.value = null
  try {
    result.value = PreorderCampaignPage.parse(
      await session.adminFetch('/api/admin/preorder-campaigns', {
        query: { state: state.value, page: page.value, pageSize: PAGE_SIZE },
      }),
    )
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function setState(value: typeof state.value) {
  state.value = value
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
        <h1 class="admin-page-title">Đợt đặt trước</h1>
        <p class="admin-page-desc">
          Mỗi đợt mở nhận cọc cho một sản phẩm, với số suất từng biến thể. Khách chỉ thấy "Đặt trước" khi biến thể hết
          hàng sẵn, đợt đang mở và còn suất. Mỗi sản phẩm có tối đa một đợt đang mở.
        </p>
      </div>
      <NuxtLink v-if="canManage" to="/admin/preorders/new" class="btn btn-primary btn-sm">+ Mở đợt</NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div role="group" aria-label="Lọc theo trạng thái" style="display: flex; gap: 8px; margin-bottom: 12px">
      <button
        v-for="s in STATES"
        :key="s.value"
        type="button"
        class="btn btn-sm"
        :class="state === s.value ? 'btn-primary' : 'btn-secondary'"
        :aria-pressed="state === s.value"
        @click="setState(s.value)"
      >
        {{ s.label }}
      </button>
    </div>

    <div class="admin-table-card">
      <div
        v-if="!result || result.items.length === 0"
        style="padding: 40px; text-align: center; color: var(--adm-muted)"
      >
        Chưa có đợt đặt trước nào.
      </div>
      <div v-else>
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Sản phẩm</th>
                <th>Trạng thái</th>
                <th class="admin-table-num">Cọc</th>
                <th>Giao dự kiến</th>
                <th>Hạn đóng</th>
                <th class="admin-table-num">Đã đặt / suất</th>
                <th>Nhập hàng</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in result.items" :key="c.id">
                <td>
                  <NuxtLink :to="`/admin/preorders/${c.id}`" style="font-weight: 600">{{ c.product.name }}</NuxtLink>
                  <div style="font-size: 12px; color: var(--adm-muted)">{{ c.variantCount }} biến thể</div>
                </td>
                <td>
                  <span class="badge" :class="c.isOpen ? 'badge-published' : 'badge-archived'">
                    {{ c.isOpen ? 'Đang mở' : 'Đã đóng' }}
                  </span>
                </td>
                <td class="admin-table-num">{{ c.depositPercent }}%</td>
                <td style="white-space: nowrap">
                  {{ formatDateOnly(c.deliveryFrom) }} – {{ formatDateOnly(c.deliveryTo) }}
                </td>
                <td style="white-space: nowrap; font-size: 12px">{{ formatDateTime(c.closedAt ?? c.closesAt) }}</td>
                <td class="admin-table-num">{{ c.totalUsed }} / {{ c.totalAllocation }}</td>
                <td style="font-size: 12px">{{ PREORDER_SUPPLY_LABELS[c.supplyStatus] }}</td>
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
            Trang <strong>{{ page }}</strong> / <strong>{{ lastPage }}</strong> ({{ result.total }} đợt)
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
