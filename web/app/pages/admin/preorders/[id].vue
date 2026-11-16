<script setup lang="ts">
import { AdminProduct, PreorderCampaign, type FieldError, type PreorderCampaignUpdate } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: ['order.view', 'preorder.manage'] })

const session = useAdminSession()
const route = useRoute()
const canManage = computed(() => session.can('preorder.manage'))
const campaign = ref<PreorderCampaign | null>(null)
const product = ref<AdminProduct | null>(null)
const editing = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const errors = ref<FieldError[]>([])
const url = `/api/admin/preorder-campaigns/${String(route.params.id)}`

try {
  campaign.value = PreorderCampaign.parse(await session.adminFetch(url))
} catch (err) {
  error.value = apiErrorMessage(err)
}

async function startEditing() {
  editing.value = true
  errors.value = []
  notice.value = null
  // Thêm biến thể mới vào đợt cần đọc sản phẩm; không có quyền xem sản phẩm thì chỉ sửa được biến thể đã có trong đợt.
  const productsPermission = ADMIN_MENU_ITEMS.find((item) => item.to === '/admin/products')?.permission
  if (!product.value && campaign.value && productsPermission && session.can(productsPermission)) {
    try {
      product.value = AdminProduct.parse(await session.adminFetch(`/api/admin/products/${campaign.value.product.id}`))
    } catch {
      product.value = null
    }
  }
}

async function save(body: PreorderCampaignUpdate) {
  busy.value = true
  error.value = null
  try {
    campaign.value = PreorderCampaign.parse(await session.adminFetch(url, { method: 'PATCH', body }))
    editing.value = false
    notice.value = 'Đã lưu đợt đặt trước'
  } catch (err) {
    errors.value = apiFieldErrors(err)
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}

async function close() {
  if (!campaign.value) return
  if (
    !confirm(
      `Đóng đợt đặt trước của ${campaign.value.product.name}? Khách sẽ không đặt thêm được, và không mở lại được.`,
    )
  )
    return
  busy.value = true
  error.value = null
  try {
    campaign.value = PreorderCampaign.parse(await session.adminFetch(`${url}/close`, { method: 'POST' }))
    notice.value = 'Đã đóng đợt'
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
        <h1 class="admin-page-title">Đợt đặt trước{{ campaign ? ` · ${campaign.product.name}` : '' }}</h1>
        <p v-if="campaign" class="admin-page-desc">
          Mở bởi {{ campaign.createdBy.name }} lúc {{ formatDateTime(campaign.createdAt) }}
          <template v-if="campaign.closedAt"> · đóng tay lúc {{ formatDateTime(campaign.closedAt) }}</template>
        </p>
      </div>
      <div style="display: flex; gap: 8px">
        <button
          v-if="canManage && campaign && !editing"
          type="button"
          class="btn btn-secondary btn-sm"
          @click="startEditing"
        >
          Sửa đợt
        </button>
        <button
          v-if="canManage && campaign?.isOpen && !editing"
          type="button"
          class="btn btn-secondary btn-sm"
          :disabled="busy"
          @click="close"
        >
          Đóng đợt
        </button>
        <NuxtLink to="/admin/preorders" class="btn btn-secondary btn-sm">‹ Danh sách đợt</NuxtLink>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>
    <div v-if="notice" class="admin-alert admin-alert-success" role="status">
      <span>{{ notice }}</span>
    </div>

    <div v-if="campaign && editing" class="admin-panel" style="padding: 16px 20px">
      <AdminPreorderCampaignForm
        :product="product"
        :campaign="campaign"
        :busy="busy"
        :errors="errors"
        submit-label="Lưu"
        @submit="save"
        @cancel="editing = false"
      />
    </div>

    <template v-else-if="campaign">
      <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
        <dl style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 0">
          <div>
            <dt class="form-label">Trạng thái</dt>
            <dd>
              <span class="badge" :class="campaign.isOpen ? 'badge-published' : 'badge-archived'">
                {{ campaign.isOpen ? 'Đang mở' : 'Đã đóng' }}
              </span>
            </dd>
          </div>
          <div>
            <dt class="form-label">Mức cọc</dt>
            <dd>{{ campaign.depositPercent }}%</dd>
          </div>
          <div>
            <dt class="form-label">Giao dự kiến</dt>
            <dd>{{ formatDateOnly(campaign.deliveryFrom) }} – {{ formatDateOnly(campaign.deliveryTo) }}</dd>
          </div>
          <div>
            <dt class="form-label">Hạn đóng nhận đặt</dt>
            <dd>{{ formatDateTime(campaign.closesAt) }}</dd>
          </div>
          <div>
            <dt class="form-label">Trả phần còn lại trong</dt>
            <dd>{{ campaign.remainderDays }} ngày từ lúc hàng về</dd>
          </div>
          <div>
            <dt class="form-label">Tiến độ nhập hàng</dt>
            <dd>{{ PREORDER_SUPPLY_LABELS[campaign.supplyStatus] }}</dd>
          </div>
          <div v-if="campaign.supplyNote" style="grid-column: 1 / -1">
            <dt class="form-label">Ghi chú nội bộ</dt>
            <dd>{{ campaign.supplyNote }}</dd>
          </div>
        </dl>
      </div>

      <div class="admin-table-card">
        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Biến thể</th>
                <th class="admin-table-num">Suất</th>
                <th class="admin-table-num">Đã đặt</th>
                <th class="admin-table-num">Đã cọc</th>
                <th class="admin-table-num">Chờ cọc</th>
                <th class="admin-table-num">Đã về</th>
                <th class="admin-table-num">Còn suất</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in campaign.variants" :key="v.variantId" data-testid="campaign-variant">
                <td style="font-family: var(--adm-mono); font-size: 12px; font-weight: 600">{{ v.sku }}</td>
                <td style="font-size: 12px">
                  {{ variantLabel(v.attributes) || '—' }}
                  <span v-if="v.status !== 'active'" style="color: var(--adm-muted)">(ngừng bán)</span>
                </td>
                <td class="admin-table-num">{{ v.allocation }}</td>
                <td class="admin-table-num">{{ v.used }}</td>
                <td class="admin-table-num">{{ v.deposited }}</td>
                <td class="admin-table-num">{{ v.pendingDeposit }}</td>
                <td class="admin-table-num">{{ v.arrived }}</td>
                <td class="admin-table-num">{{ Math.max(0, v.allocation - v.used) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <h2 class="admin-section-title" style="margin-top: 24px">
        Đơn theo thứ tự cọc
        <NuxtLink :to="`/admin/orders?campaignId=${campaign.id}`" style="font-size: 12px; font-weight: 400">
          · mở ở trang Đơn hàng
        </NuxtLink>
      </h2>
      <p style="font-size: 12px; color: var(--adm-muted); margin: 0 0 8px">
        Hàng nhập về được chia cho các đơn đã cọc theo đúng thứ tự này; đơn chờ cọc chưa được chia.
      </p>
      <div class="admin-table-card">
        <div v-if="campaign.orders.length === 0" style="padding: 24px; text-align: center; color: var(--adm-muted)">
          Đợt chưa có đơn nào.
        </div>
        <div v-else style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Người nhận</th>
                <th>SKU</th>
                <th class="admin-table-num">Đã về / số lượng</th>
                <th>Cọc lúc</th>
                <th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="o in campaign.orders" :key="o.code" data-testid="campaign-order">
                <td>
                  <NuxtLink :to="`/admin/orders/${o.code}`" style="font-family: var(--adm-mono); font-weight: 600">
                    #{{ o.code }}
                  </NuxtLink>
                </td>
                <td>{{ o.recipientName }}</td>
                <td style="font-family: var(--adm-mono); font-size: 12px">{{ o.sku }}</td>
                <td class="admin-table-num">{{ o.arrivedQuantity }}/{{ o.quantity }}</td>
                <td style="font-size: 12px; white-space: nowrap">
                  {{ o.depositPaidAt ? formatDateTime(o.depositPaidAt) : 'Chưa cọc' }}
                </td>
                <td style="font-size: 12px">
                  {{ PAYMENT_STATUS_LABELS[o.paymentStatus] }} · {{ FULFILLMENT_STATUS_LABELS[o.fulfillmentStatus] }}
                  <div v-if="o.remainderOverdueAt" style="color: #b45309; font-weight: 600">
                    Quá hạn trả phần còn lại
                  </div>
                  <div
                    v-else-if="o.remainderDueAt && o.paymentStatus === 'deposit_paid'"
                    style="color: var(--adm-muted)"
                  >
                    Hạn trả {{ formatDateTime(o.remainderDueAt) }}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
