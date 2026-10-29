<script setup lang="ts">
import { STOCK_VIEW_PERMISSIONS, StockReceipt } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: STOCK_VIEW_PERMISSIONS })

const session = useAdminSession()
const route = useRoute()
const receipt = ref<StockReceipt | null>(null)
const error = ref<string | null>(null)

try {
  receipt.value = StockReceipt.parse(await session.adminFetch(`/api/admin/stock/receipts/${String(route.params.id)}`))
} catch (err) {
  error.value = apiErrorMessage(err)
}

const total = computed(() => receipt.value?.lines.reduce((sum, l) => sum + l.quantity, 0) ?? 0)
const formatDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN')
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Phiếu nhập kho</h1>
        <p v-if="receipt" class="admin-page-desc">
          {{ receipt.supplierName }} · hàng về ngày {{ formatDate(receipt.receivedOn) }} · ghi bởi
          {{ receipt.createdBy.name }} lúc {{ new Date(receipt.createdAt).toLocaleString('vi-VN') }}
        </p>
      </div>
      <NuxtLink to="/admin/stock/receipts" class="btn btn-secondary btn-sm">‹ Danh sách phiếu</NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div v-if="receipt" class="admin-table-card">
      <p v-if="receipt.note" style="padding: 14px 18px 0; margin: 0; font-size: 13px">Ghi chú: {{ receipt.note }}</p>
      <div style="overflow-x: auto">
        <table class="admin-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Sản phẩm</th>
              <th class="admin-table-num">Số lượng nhập</th>
              <th class="admin-table-num">Tồn sau khi nhập</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="line in receipt.lines" :key="line.variantId">
              <td>
                <NuxtLink
                  :to="`/admin/stock/movements?variantId=${line.variantId}`"
                  style="font-family: var(--adm-mono); font-size: 12px; font-weight: 600"
                >
                  {{ line.sku }}
                </NuxtLink>
              </td>
              <td>{{ line.productName }}</td>
              <td class="admin-table-num">{{ line.quantity }}</td>
              <td class="admin-table-num">{{ line.onHandAfter }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="font-weight: 600">Tổng</td>
              <td class="admin-table-num" style="font-weight: 600">{{ total }}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>
</template>
