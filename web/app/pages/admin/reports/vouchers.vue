<script setup lang="ts">
import { VoucherReport } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'report.view' })

const session = useAdminSession()
const canOpen = session.canOpen
const period = useReportPeriod()
const report = ref<VoucherReport | null>(null)
const error = ref<string | null>(null)

async function load() {
  error.value = null
  const query = { from: period.value.from, to: period.value.to }
  try {
    report.value = VoucherReport.parse(await session.adminFetch('/api/admin/reports/vouchers', { query }))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

await load()
watch(period, load)
</script>

<template>
  <div>
    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <p style="margin: 0 0 12px; font-size: 12px; color: var(--adm-muted)">
      Tính các đơn dùng mã, tạo trong kỳ và chưa hủy. Mã và mức giảm hiện theo cấu hình hiện tại của mã; tiền giảm là số
      chụp trên từng đơn. Số đơn đã giao tính tới lúc xem.
    </p>

    <div v-if="report" class="admin-table-card">
      <div v-if="!report.items.length" style="padding: 40px; text-align: center; color: var(--adm-muted)">
        Không có đơn nào dùng mã trong kỳ.
      </div>
      <div v-else style="overflow-x: auto">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Mã</th>
              <th>Mức giảm</th>
              <th class="admin-table-num">Số lượt</th>
              <th class="admin-table-num">Tiền giảm</th>
              <th class="admin-table-num">Tiền hàng sau giảm</th>
              <th class="admin-table-num">Đơn đã giao</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in report.items" :key="item.voucherId">
              <td style="font-family: var(--adm-mono); font-size: 12px; font-weight: 600">
                <NuxtLink v-if="canOpen('/admin/vouchers')" :to="`/admin/vouchers/${item.voucherId}`">{{
                  item.code
                }}</NuxtLink>
                <span v-else>{{ item.code }}</span>
              </td>
              <td style="font-size: 12px">{{ voucherValueLabel(item) }}</td>
              <td class="admin-table-num">{{ item.redemptions }}</td>
              <td class="admin-table-num">{{ formatVnd(item.discount) }}</td>
              <td class="admin-table-num">{{ formatVnd(item.netGoods) }}</td>
              <td class="admin-table-num">{{ item.deliveredOrders }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr style="font-weight: 600">
              <td colspan="2">Tổng</td>
              <td class="admin-table-num">{{ report.totals.redemptions }}</td>
              <td class="admin-table-num">{{ formatVnd(report.totals.discount) }}</td>
              <td class="admin-table-num">{{ formatVnd(report.totals.netGoods) }}</td>
              <td class="admin-table-num">{{ report.totals.deliveredOrders }}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </div>
</template>
