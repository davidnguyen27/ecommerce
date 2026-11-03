<script setup lang="ts">
import { AdminOrder, type OrderHistoryEntry } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'order.view' })

/*
 * Trang chi tiết đơn. Mỗi phần xử lý đơn là một panel đọc `order`; thao tác đổi trạng thái gọi API rồi `setOrder` bằng
 * `AdminOrder` mà API trả về (hoặc `load()` khi API trả 204). Ticket sau thêm panel vào cột phải (xử lý giao hàng) hay
 * cột trái (đối soát), không cần sửa các phần có sẵn.
 */

const session = useAdminSession()
const route = useRoute()
const code = String(route.params.code)
const order = ref<AdminOrder | null>(null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref(false)

const canFulfill = computed(() => session.can('order.fulfill'))

function setOrder(value: unknown) {
  order.value = AdminOrder.parse(value)
}

async function load() {
  try {
    setOrder(await session.adminFetch(`/api/admin/orders/${code}`))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

async function cancelOrder() {
  if (!confirm(`Hủy đơn #${code}? Hàng đang giữ sẽ được nhả và link thanh toán bị hủy.`)) return
  busy.value = true
  error.value = null
  notice.value = null
  try {
    await session.adminFetch(`/api/admin/orders/${code}/cancel`, { method: 'POST' })
    notice.value = 'Đã hủy đơn'
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    // Cả khi lỗi (ví dụ đơn vừa được trả tiền): nạp lại để thấy trạng thái mới.
    await load()
    busy.value = false
  }
}

function actorText(entry: OrderHistoryEntry) {
  const actor = entry.actor
  if (actor.type === 'staff') return `${actor.name} (${actor.email})`
  if (actor.type === 'customer') return actor.email ? `Khách ${actor.email}` : 'Khách (qua link tra cứu)'
  return 'Hệ thống'
}

function historyTitle(entry: OrderHistoryEntry) {
  return entry.source === 'event' ? orderEventLabel(entry.action) : auditActionLabel(entry.action)
}

/** Chi tiết ngắn cho các sự kiện có dữ liệu đáng xem. */
function historyDetail(entry: OrderHistoryEntry) {
  if (entry.source !== 'event') return ''
  const data = (entry.data ?? {}) as {
    reason?: string
    amount?: number
    total?: number
    carrier?: string
    trackingNumber?: string
  }
  if (entry.action === 'handed_over' && data.carrier) return `${data.carrier} · ${data.trackingNumber}`
  if (entry.action === 'cancelled' && data.reason) {
    return CANCEL_REASON_LABELS[data.reason as keyof typeof CANCEL_REASON_LABELS] ?? data.reason
  }
  if (entry.action === 'payment_flagged' && data.reason) {
    const reason = RECONCILIATION_REASON_LABELS[data.reason as keyof typeof RECONCILIATION_REASON_LABELS]
    return `${reason ?? data.reason}${data.amount ? ` · ${formatVnd(data.amount)}` : ''}`
  }
  if (typeof data.amount === 'number') return formatVnd(data.amount)
  if (typeof data.total === 'number') return `Tổng ${formatVnd(data.total)}`
  return ''
}

const fullAddress = computed(() => {
  const a = order.value?.address
  return a ? `${a.streetAddress}, ${a.wardName}, ${a.provinceName}` : ''
})
const itemCount = computed(() => order.value?.lines.reduce((sum, l) => sum + l.quantity, 0) ?? 0)

const print = () => window.print()

await load()
</script>

<template>
  <div>
    <div class="admin-no-print">
      <div class="admin-page-header">
        <div>
          <h1 class="admin-page-title">Đơn hàng #{{ code }}</h1>
          <p v-if="order" class="admin-page-desc">
            Đặt lúc {{ formatDateTime(order.createdAt) }} ·
            {{ order.customerId ? 'Khách có tài khoản' : 'Khách vãng lai' }}
          </p>
        </div>
        <div style="display: flex; gap: 8px">
          <button v-if="order" type="button" class="btn btn-secondary btn-sm" @click="print">In phiếu soạn hàng</button>
          <button
            v-if="order && canFulfill && order.status === 'pending_payment'"
            type="button"
            class="btn btn-danger btn-sm"
            data-testid="admin-order-cancel"
            :disabled="busy"
            @click="cancelOrder"
          >
            Hủy đơn
          </button>
          <NuxtLink to="/admin/orders" class="btn btn-secondary btn-sm">‹ Danh sách đơn</NuxtLink>
        </div>
      </div>

      <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
        <span>{{ error }}</span>
      </div>
      <div v-if="notice" class="admin-alert admin-alert-success" role="status">
        <span>{{ notice }}</span>
      </div>

      <div v-if="order" class="admin-two-col">
        <div>
          <div class="admin-table-card" style="margin-bottom: 24px">
            <div style="overflow-x: auto">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Sản phẩm</th>
                    <th class="admin-table-num">Đơn giá</th>
                    <th class="admin-table-num">SL</th>
                    <th class="admin-table-num">Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="line in order.lines" :key="line.variantId">
                    <td style="font-family: var(--adm-mono); font-size: 12px; font-weight: 600">{{ line.sku }}</td>
                    <td>
                      <div>{{ line.productName }}</div>
                      <div style="font-size: 12px; color: var(--adm-muted)">
                        {{ variantAttributesText(line.attributes) }}
                      </div>
                    </td>
                    <td class="admin-table-num">{{ formatVnd(line.price) }}</td>
                    <td class="admin-table-num">{{ line.quantity }}</td>
                    <td class="admin-table-num">{{ formatVnd(line.lineTotal) }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="4">Tạm tính</td>
                    <td class="admin-table-num">{{ formatVnd(order.subtotal) }}</td>
                  </tr>
                  <tr>
                    <td colspan="4">Phí giao</td>
                    <td class="admin-table-num">{{ formatVnd(order.shippingFee) }}</td>
                  </tr>
                  <tr>
                    <td colspan="4" style="font-weight: 600">Tổng</td>
                    <td class="admin-table-num" style="font-weight: 600">{{ formatVnd(order.total) }}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <h2 class="admin-section-title">Giao dịch thanh toán</h2>
          <div class="admin-table-card" style="margin-bottom: 24px">
            <div v-if="order.payments.length === 0" style="padding: 20px; color: var(--adm-muted)">
              Chưa có khoản tiền nào về.
            </div>
            <div v-else style="overflow-x: auto">
              <table class="admin-table">
                <thead>
                  <tr>
                    <th>Thời điểm</th>
                    <th>Mã tham chiếu</th>
                    <th>Nguồn</th>
                    <th class="admin-table-num">Số tiền</th>
                    <th>Đối soát</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in order.payments" :key="p.id" data-testid="admin-order-payment">
                    <td style="white-space: nowrap">{{ formatDateTime(p.paidAt) }}</td>
                    <td style="font-family: var(--adm-mono); font-size: 12px">{{ p.reference }}</td>
                    <td>{{ PAYMENT_SOURCE_LABELS[p.source] }}</td>
                    <td class="admin-table-num">{{ formatVnd(p.amount) }}</td>
                    <td style="font-size: 12px">
                      <span v-if="p.reconciliation">
                        {{ RECONCILIATION_REASON_LABELS[p.reconciliation.reason] }} ·
                        {{ p.reconciliation.status === 'open' ? 'chưa xử lý' : 'đã xử lý' }}
                      </span>
                      <span v-else style="color: var(--adm-muted)">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <AdminReconciliationPanel :order="order" style="margin-bottom: 24px" @update="setOrder" />

          <h2 class="admin-section-title">Lịch sử thao tác</h2>
          <div class="admin-table-card">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Lúc</th>
                  <th>Việc</th>
                  <th>Người làm</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(entry, index) in order.history" :key="index" data-testid="admin-order-history">
                  <td style="white-space: nowrap">{{ formatDateTime(entry.at, { seconds: true }) }}</td>
                  <td>
                    <div>{{ historyTitle(entry) }}</div>
                    <div v-if="historyDetail(entry)" style="font-size: 12px; color: var(--adm-muted)">
                      {{ historyDetail(entry) }}
                    </div>
                  </td>
                  <td style="font-size: 12px">{{ actorText(entry) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <AdminFulfillmentPanel :order="order" :can-fulfill="canFulfill" @update="setOrder" @reload="load" />

          <div class="admin-panel">
            <h2 class="admin-section-title">Trạng thái</h2>
            <dl style="margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 13px">
              <dt style="color: var(--adm-muted)">Đơn</dt>
              <dd style="margin: 0" data-testid="admin-order-status">{{ ORDER_STATUS_LABELS[order.status] }}</dd>
              <dt style="color: var(--adm-muted)">Thanh toán</dt>
              <dd style="margin: 0">{{ PAYMENT_STATUS_LABELS[order.paymentStatus] }}</dd>
              <dt style="color: var(--adm-muted)">Giao hàng</dt>
              <dd style="margin: 0">{{ FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus] }}</dd>
              <template v-if="order.reservedUntil">
                <dt style="color: var(--adm-muted)">Giữ hàng tới</dt>
                <dd style="margin: 0">{{ formatDateTime(order.reservedUntil) }}</dd>
              </template>
              <template v-if="order.cancelReason && order.cancelledAt">
                <dt style="color: var(--adm-muted)">Hủy</dt>
                <dd style="margin: 0">
                  {{ CANCEL_REASON_LABELS[order.cancelReason] }}, {{ formatDateTime(order.cancelledAt) }}
                </dd>
              </template>
            </dl>
          </div>

          <div class="admin-panel">
            <h2 class="admin-section-title">Nhận hàng</h2>
            <div style="font-size: 13px">
              <div style="font-weight: 600">{{ order.address.recipientName }}</div>
              <div>{{ order.address.phone }} · {{ order.address.email }}</div>
              <div>{{ fullAddress }}</div>
              <div v-if="order.note" style="margin-top: 8px">Ghi chú: {{ order.note }}</div>
            </div>
          </div>

          <div class="admin-panel" data-testid="admin-order-invoice">
            <h2 class="admin-section-title">Xuất hóa đơn công ty</h2>
            <div v-if="order.invoice" style="font-size: 13px">
              <div style="font-weight: 600">{{ order.invoice.companyName }}</div>
              <div>MST: {{ order.invoice.taxCode }}</div>
              <div>{{ order.invoice.address }}</div>
            </div>
            <div v-else style="font-size: 13px; color: var(--adm-muted)">Không xuất hóa đơn công ty.</div>
          </div>

          <div v-if="order.policies.length || order.privacyConsent" class="admin-panel">
            <h2 class="admin-section-title">Chính sách lúc đặt</h2>
            <ul style="margin: 0; padding-left: 18px; font-size: 13px">
              <li v-for="p in order.policies" :key="p.slug">{{ p.title }} (phiên bản {{ p.version }})</li>
              <li v-if="order.privacyConsent">
                Đồng ý chính sách bảo mật phiên bản {{ order.privacyConsent.policyVersion }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>

    <!-- Phiếu soạn hàng: chỉ hiện khi in. -->
    <section v-if="order" class="admin-print-only" data-testid="pick-slip">
      <h1 style="font-size: 20px; margin: 0 0 4px">Phiếu soạn hàng · Đơn #{{ order.code }}</h1>
      <p style="margin: 0 0 12px; font-size: 13px">Đặt lúc {{ formatDateTime(order.createdAt) }}</p>
      <p style="margin: 0 0 16px; font-size: 13px">
        <strong>{{ order.address.recipientName }}</strong> · {{ order.address.phone }}<br />
        {{ fullAddress }}
        <template v-if="order.note"><br />Ghi chú: {{ order.note }}</template>
      </p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px">
        <thead>
          <tr>
            <th style="text-align: left; border-bottom: 1px solid #000; padding: 4px">SKU</th>
            <th style="text-align: left; border-bottom: 1px solid #000; padding: 4px">Sản phẩm</th>
            <th style="text-align: left; border-bottom: 1px solid #000; padding: 4px">Thuộc tính</th>
            <th style="text-align: right; border-bottom: 1px solid #000; padding: 4px">SL</th>
            <th style="border-bottom: 1px solid #000; padding: 4px">Đã soạn</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="line in order.lines" :key="line.variantId">
            <td style="font-family: var(--adm-mono); border-bottom: 1px solid #ccc; padding: 4px">{{ line.sku }}</td>
            <td style="border-bottom: 1px solid #ccc; padding: 4px">{{ line.productName }}</td>
            <td style="border-bottom: 1px solid #ccc; padding: 4px">{{ variantAttributesText(line.attributes) }}</td>
            <td style="text-align: right; border-bottom: 1px solid #ccc; padding: 4px">{{ line.quantity }}</td>
            <td style="border-bottom: 1px solid #ccc; padding: 4px; text-align: center">☐</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding: 4px; font-weight: 600">Tổng số món</td>
            <td style="text-align: right; padding: 4px; font-weight: 600">{{ itemCount }}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </section>
  </div>
</template>
