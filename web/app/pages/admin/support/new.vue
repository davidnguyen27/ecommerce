<script setup lang="ts">
import {
  AdminOrder,
  AdminSupportRequest,
  ExchangeOptions,
  canRequestCancel,
  type AdminCreateSupportRequest,
  type CreatableSupportKind,
} from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'support.handle' })

/**
 * Nhân viên tạo yêu cầu thay cho khách gọi điện hay nhắn tin: gắn với một đơn, hoặc với tài khoản khách theo email.
 * Có đơn thì tạo được thêm hủy (đơn đã nhận tiền, chưa giao đi), trả, đổi, bảo hành (đơn đã giao xong), như khách tự gửi.
 */
const session = useAdminSession()
const route = useRoute()
const form = reactive({
  orderCode: typeof route.query.orderCode === 'string' ? route.query.orderCode : '',
  customerEmail: '',
  kind: 'other' as CreatableSupportKind,
  subject: '',
  message: '',
})
const busy = ref(false)
const error = ref<string | null>(null)

// Đơn đang gắn: tải khi nhập mã, để biết loại nào tạo được và dòng nào chọn được.
const order = ref<AdminOrder | null>(null)
const orderError = ref<string | null>(null)
async function loadOrder() {
  const code = form.orderCode.trim()
  order.value = null
  orderError.value = null
  form.kind = 'other'
  if (!/^\d+$/.test(code)) return
  try {
    order.value = AdminOrder.parse(await session.adminFetch(`/api/admin/orders/${code}`))
  } catch (err) {
    orderError.value = apiErrorMessage(err)
  }
}
onMounted(loadOrder)

const canCancel = computed(() => !!order.value && canRequestCancel(order.value))
const delivered = computed(() => order.value?.status === 'completed' && order.value.fulfillmentStatus === 'delivered')
const lineKind = computed(() =>
  form.kind === 'return' || form.kind === 'exchange' || form.kind === 'warranty' ? form.kind : null,
)
const needsLines = computed(() => lineKind.value !== null)
const pickedLines = ref<NonNullable<Extract<AdminCreateSupportRequest, { lines: unknown }>['lines']>>([])
const loadExchangeOptions = async () =>
  ExchangeOptions.parse(
    await session.adminFetch('/api/admin/support-requests/exchange-options', {
      query: { orderCode: form.orderCode.trim() },
    }),
  )

async function submit() {
  busy.value = true
  error.value = null
  try {
    const base = {
      orderCode: order.value ? order.value.code : undefined,
      customerEmail: form.orderCode.trim() ? undefined : form.customerEmail.trim() || undefined,
      subject: form.subject,
      message: form.message,
    }
    const created = AdminSupportRequest.parse(
      await session.adminFetch('/api/admin/support-requests', {
        method: 'POST',
        body: needsLines.value ? { ...base, kind: form.kind, lines: pickedLines.value } : { ...base, kind: form.kind },
      }),
    )
    await navigateTo(`/admin/support/${created.code}`)
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
        <h1 class="admin-page-title">Tạo yêu cầu hộ khách</h1>
        <p class="admin-page-desc">Khách nhận email kèm link để theo dõi và trả lời yêu cầu.</p>
      </div>
      <NuxtLink to="/admin/support" class="btn btn-secondary btn-sm">‹ Danh sách yêu cầu</NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <form class="admin-panel" style="max-width: 720px" @submit.prevent="submit">
      <div class="form-group">
        <label class="form-label" for="support-new-order">Mã đơn</label>
        <input
          id="support-new-order"
          v-model="form.orderCode"
          class="form-input"
          inputmode="numeric"
          @change="loadOrder"
        />
        <div class="form-help">Bỏ trống nếu yêu cầu không gắn đơn; khi đó cần email tài khoản khách.</div>
        <small v-if="orderError" class="field-error-msg">{{ orderError }}</small>
        <div v-else-if="order" class="form-help">
          {{ order.address.recipientName }} · {{ ORDER_STATUS_LABELS[order.status] }} ·
          {{ FULFILLMENT_STATUS_LABELS[order.fulfillmentStatus] }}
        </div>
      </div>
      <div v-if="!form.orderCode.trim()" class="form-group">
        <label class="form-label" for="support-new-email">Email tài khoản khách</label>
        <input id="support-new-email" v-model="form.customerEmail" type="email" class="form-input" />
      </div>
      <div v-if="order" class="form-group">
        <label class="form-label" for="support-new-kind">Loại yêu cầu</label>
        <select id="support-new-kind" v-model="form.kind" class="form-select">
          <option value="other">{{ SUPPORT_KIND_LABELS.other }}</option>
          <option v-if="canCancel" value="cancel">{{ SUPPORT_KIND_LABELS.cancel }}</option>
          <template v-if="delivered">
            <option value="return">{{ SUPPORT_KIND_LABELS.return }}</option>
            <option value="exchange">{{ SUPPORT_KIND_LABELS.exchange }}</option>
            <option value="warranty">{{ SUPPORT_KIND_LABELS.warranty }}</option>
          </template>
        </select>
      </div>
      <div v-if="order && lineKind" class="form-group">
        <SupportLinesPicker
          v-model="pickedLines"
          admin
          :kind="lineKind"
          :lines="order.lines"
          :load-exchange-options="loadExchangeOptions"
        />
      </div>
      <div class="form-group">
        <label class="form-label" for="support-new-subject">Tiêu đề</label>
        <input id="support-new-subject" v-model="form.subject" class="form-input" maxlength="200" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="support-new-message">Nội dung khách nhờ</label>
        <textarea
          id="support-new-message"
          v-model="form.message"
          class="form-textarea"
          rows="5"
          maxlength="5000"
          required
        />
      </div>
      <button type="submit" class="btn btn-primary btn-sm" :disabled="busy || (needsLines && pickedLines.length === 0)">
        Tạo yêu cầu
      </button>
    </form>
  </div>
</template>
