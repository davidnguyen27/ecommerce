<script setup lang="ts">
import { ReconciliationPage, type ReconciliationQuery } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'order.view' })

const PAGE_SIZE = 50

const session = useAdminSession()
const result = ref<ReconciliationPage | null>(null)
const error = ref<string | null>(null)
const status = ref<ReconciliationQuery['status']>('open')
const page = ref(1)

async function load() {
  error.value = null
  try {
    result.value = ReconciliationPage.parse(
      await session.adminFetch('/api/admin/reconciliation', {
        query: { status: status.value, page: page.value, pageSize: PAGE_SIZE },
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
        <h1 class="admin-page-title">Cần đối soát</h1>
        <p class="admin-page-desc">
          Tiền về không khớp với đơn: lệch số tiền, về sau khi đơn đã hủy, hoặc trả thừa. Hệ thống không tự xử lý; mở
          đơn để khôi phục đơn hoặc ghi là đã xử lý ngoài hệ thống.
        </p>
      </div>
      <div class="form-group" style="margin-bottom: 0; min-width: 180px">
        <label class="form-label" for="reconciliation-status" style="font-size: 12px">Trạng thái</label>
        <select id="reconciliation-status" v-model="status" class="form-select" @change="filter">
          <option value="open">Chưa xử lý</option>
          <option value="resolved">Đã xử lý</option>
          <option value="all">Tất cả</option>
        </select>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div class="admin-table-card">
      <div
        v-if="!result || result.items.length === 0"
        style="padding: 40px; text-align: center; color: var(--adm-muted)"
      >
        Không có mục nào.
      </div>
      <div v-else>
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Đơn</th>
                <th>Tiền về lúc</th>
                <th>Lý do</th>
                <th class="admin-table-num">Số tiền nhận</th>
                <th class="admin-table-num">Đơn đã nhận / phải trả</th>
                <th>Trạng thái đơn</th>
                <th>Xử lý</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in result.items" :key="item.id" data-testid="reconciliation-row">
                <td>
                  <NuxtLink
                    :to="`/admin/orders/${item.order.code}#doi-soat`"
                    style="font-family: var(--adm-mono); font-weight: 600"
                  >
                    #{{ item.order.code }}
                  </NuxtLink>
                  <div style="font-size: 12px; color: var(--adm-muted)">{{ item.order.recipientName }}</div>
                </td>
                <td style="white-space: nowrap">{{ formatDateTime(item.receivedAt) }}</td>
                <td>{{ RECONCILIATION_REASON_LABELS[item.reason] }}</td>
                <td class="admin-table-num">{{ formatVnd(item.amount) }}</td>
                <td class="admin-table-num">
                  {{ formatVnd(item.order.received) }} / {{ formatVnd(item.order.total) }}
                </td>
                <td style="font-size: 12px">
                  <div>{{ ORDER_STATUS_LABELS[item.order.status] }}</div>
                  <div style="color: var(--adm-muted)">{{ PAYMENT_STATUS_LABELS[item.order.paymentStatus] }}</div>
                </td>
                <td style="font-size: 12px">
                  <template v-if="item.resolution">
                    <div>{{ RECONCILIATION_RESOLUTION_LABELS[item.resolution] }}</div>
                    <div style="color: var(--adm-muted)">
                      {{ item.resolvedBy?.name
                      }}<template v-if="item.resolvedAt"> · {{ formatDateTime(item.resolvedAt) }}</template>
                    </div>
                  </template>
                  <span v-else>Chưa xử lý</span>
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
            Trang <strong>{{ page }}</strong> / <strong>{{ lastPage }}</strong> ({{ result.total }} mục)
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
