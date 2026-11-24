<script setup lang="ts">
import { PreorderAttention } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'order.view' })

// Sales follow-up on pre-orders: contact customers with an overdue remainder, and customers of troubled campaigns.
const session = useAdminSession()
const result = ref<PreorderAttention | null>(null)
const error = ref<string | null>(null)

try {
  result.value = PreorderAttention.parse(await session.adminFetch('/api/admin/preorder-campaigns/attention'))
} catch (err) {
  error.value = apiErrorMessage(err)
}
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Đặt trước cần xử lý</h1>
        <p class="admin-page-desc">
          Đơn quá hạn trả phần còn lại vẫn giữ hàng và khách vẫn trả được; hãy liên hệ khách. Hủy hay hoàn cọc làm ngoài
          hệ thống cho tới M6.
        </p>
      </div>
      <NuxtLink to="/admin/preorders" class="btn btn-secondary btn-sm">Đợt đặt trước</NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <template v-if="result">
      <h2 class="admin-section-title">Quá hạn trả phần còn lại ({{ result.overdueOrders.length }})</h2>
      <div class="admin-table-card" style="margin-bottom: 24px">
        <div v-if="!result.overdueOrders.length" style="padding: 24px; text-align: center; color: var(--adm-muted)">
          Không có đơn nào quá hạn.
        </div>
        <div v-else style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Khách</th>
                <th>Sản phẩm</th>
                <th class="admin-table-num">Còn phải trả</th>
                <th>Hạn trả</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in result.overdueOrders" :key="o.code" data-testid="attention-overdue">
                <td>
                  <NuxtLink :to="`/admin/orders/${o.code}`" style="font-family: var(--adm-mono); font-weight: 600">
                    #{{ o.code }}
                  </NuxtLink>
                </td>
                <td>
                  <div>{{ o.recipientName }}</div>
                  <div style="font-size: 12px; color: var(--adm-muted)">{{ o.phone }}</div>
                </td>
                <td>{{ o.productName }}</td>
                <td class="admin-table-num">{{ formatVnd(o.remainingAmount) }}</td>
                <td style="white-space: nowrap; font-size: 12px">{{ formatDateTime(o.remainderDueAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2 class="admin-section-title">Đợt gặp sự cố nhập hàng ({{ result.issueCampaigns.length }})</h2>
      <div class="admin-table-card">
        <div v-if="!result.issueCampaigns.length" style="padding: 24px; text-align: center; color: var(--adm-muted)">
          Không có đợt nào gặp sự cố.
        </div>
        <div v-else style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Sản phẩm</th>
                <th class="admin-table-num">Đơn đã cọc chưa trả đủ</th>
                <th>Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in result.issueCampaigns" :key="c.id" data-testid="attention-campaign">
                <td>
                  <NuxtLink :to="`/admin/preorders/${c.id}`" style="font-weight: 600">{{ c.productName }}</NuxtLink>
                </td>
                <td class="admin-table-num">{{ c.depositedOrders }}</td>
                <td style="font-size: 12px">{{ c.supplyNote || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
