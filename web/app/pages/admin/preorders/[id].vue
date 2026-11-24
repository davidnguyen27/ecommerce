<script setup lang="ts">
import {
  AdminProduct,
  CancelUnsuppliedResult,
  PreorderCampaign,
  UnsuppliedPreview,
  type FieldError,
  type PreorderCampaignUpdate,
} from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: ['order.view', 'preorder.manage'] })

const session = useAdminSession()
const canOpen = session.canOpen
const route = useRoute()
const canManage = computed(() => session.can('preorder.manage'))
// A campaign that cannot be supplied (M6a): cancelling paid orders and closing the campaign are two permissions, both
// needed.
const canCancelUnsupplied = computed(() => canManage.value && session.can('order.cancel_paid'))
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
  // Adding variants needs to read the product; without product view permission only existing campaign variants can be
  // edited.
  if (!product.value && campaign.value && canOpen('/admin/products')) {
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

/** Preview of the waiting orders to be cancelled; when set, the confirm block is open. */
const unsupplied = ref<UnsuppliedPreview | null>(null)
const unsuppliedNote = ref('')

async function openUnsupplied() {
  error.value = null
  notice.value = null
  try {
    unsupplied.value = UnsuppliedPreview.parse(await session.adminFetch(`${url}/cancel-unsupplied`))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

async function cancelUnsupplied() {
  if (!unsupplied.value) return
  const { orders, refundTotal } = unsupplied.value
  if (!confirm(`Hủy ${orders.length} đơn và tạo khoản hoàn tổng ${formatVnd(refundTotal)}? Đợt sẽ bị đóng.`)) return
  busy.value = true
  error.value = null
  try {
    const result = CancelUnsuppliedResult.parse(
      await session.adminFetch(`${url}/cancel-unsupplied`, { method: 'POST', body: { note: unsuppliedNote.value } }),
    )
    campaign.value = result.campaign
    unsupplied.value = null
    unsuppliedNote.value = ''
    notice.value = `Đã hủy ${result.cancelledOrderCodes.length} đơn chờ hàng và đóng đợt`
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
        <button
          v-if="canCancelUnsupplied && campaign && !editing && !unsupplied"
          type="button"
          class="btn btn-danger btn-sm"
          data-testid="campaign-cancel-unsupplied"
          :disabled="busy"
          @click="openUnsupplied"
        >
          Hủy các đơn chờ hàng (không nhập được)
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

    <form
      v-if="unsupplied"
      class="admin-panel"
      style="padding: 16px 20px; margin-bottom: 20px"
      data-testid="campaign-unsupplied"
      @submit.prevent="cancelUnsupplied"
    >
      <h2 class="admin-section-title">Không nhập được hàng</h2>
      <p v-if="unsupplied.orders.length === 0" style="margin: 0 0 12px; font-size: 13px">
        Không có đơn đã cọc nào đang chờ hàng. Xác nhận sẽ chỉ đóng đợt.
      </p>
      <template v-else>
        <p style="margin: 0 0 8px; font-size: 13px">
          {{ unsupplied.orders.length }} đơn đã cọc chưa có hàng về đủ sẽ bị hủy, mỗi đơn hoàn đủ số đã nhận; tổng
          <strong>{{ formatVnd(unsupplied.refundTotal) }}</strong
          >. Đơn đã về đủ hàng hay đã trả đủ không bị hủy.
        </p>
        <ul style="margin: 0 0 12px; padding-left: 18px; font-size: 13px">
          <li v-for="o in unsupplied.orders" :key="o.code">
            #{{ o.code }} · {{ o.recipientName }} · hoàn {{ formatVnd(o.refundAmount) }}
          </li>
        </ul>
      </template>
      <div class="form-group">
        <label class="form-label" for="unsupplied-note">Ghi chú (nhà cung cấp báo gì)</label>
        <textarea
          id="unsupplied-note"
          v-model="unsuppliedNote"
          class="form-textarea"
          rows="2"
          maxlength="2000"
          required
          data-testid="campaign-unsupplied-note"
        />
      </div>
      <div style="display: flex; gap: 8px">
        <button
          type="submit"
          class="btn btn-danger btn-sm"
          data-testid="campaign-unsupplied-submit"
          :disabled="busy || !unsuppliedNote.trim()"
        >
          Hủy đơn và đóng đợt
        </button>
        <button type="button" class="btn btn-secondary btn-sm" :disabled="busy" @click="unsupplied = null">Thôi</button>
      </div>
    </form>

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
        <NuxtLink
          v-if="canOpen('/admin/orders')"
          :to="`/admin/orders?campaignId=${campaign.id}`"
          style="font-size: 12px; font-weight: 400"
        >
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
                  <NuxtLink
                    v-if="canOpen('/admin/orders')"
                    :to="`/admin/orders/${o.code}`"
                    style="font-family: var(--adm-mono); font-weight: 600"
                  >
                    #{{ o.code }}
                  </NuxtLink>
                  <span v-else style="font-family: var(--adm-mono); font-weight: 600">#{{ o.code }}</span>
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
