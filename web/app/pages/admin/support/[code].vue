<script setup lang="ts">
import { AdminSupportRequest, StaffList, type AdminSupportReply, type StaffSummary } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: ['support.handle', 'order.view'] })

/*
 * Một yêu cầu hỗ trợ ở trang quản trị (spec M6b): chuỗi tin kể cả ghi chú nội bộ, người phụ trách, trạng thái. Người có
 * `support.handle` trả lời, ghi chú, đổi trạng thái, nhận việc; owner giao cho người khác. Phần riêng của từng loại
 * (trả, đổi, bảo hành) do các ticket sau thêm vào trang này.
 */
const session = useAdminSession()
const route = useRoute()
const code = String(route.params.code)
const request = ref<AdminSupportRequest | null>(null)
const error = ref<string | null>(null)
const busy = ref(false)
const canHandle = computed(() => session.can('support.handle'))
const canAssign = computed(() => session.can('staff.manage'))
const staff = ref<StaffSummary[]>([])
const reply = reactive({ message: '', internal: false, status: '' as '' | NonNullable<AdminSupportReply['status']> })

async function load() {
  try {
    request.value = AdminSupportRequest.parse(await session.adminFetch(`/api/admin/support-requests/${code}`))
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

async function act(path: string, body?: Record<string, unknown>) {
  busy.value = true
  error.value = null
  try {
    request.value = AdminSupportRequest.parse(
      await session.adminFetch(`/api/admin/support-requests/${code}/${path}`, { method: 'POST', body }),
    )
    return true
  } catch (err) {
    error.value = apiErrorMessage(err)
    return false
  } finally {
    busy.value = false
  }
}

async function send() {
  const ok = await act('reply', {
    message: reply.message.trim() || undefined,
    internal: reply.internal,
    status: reply.status || undefined,
  })
  if (ok) Object.assign(reply, { message: '', internal: false, status: '' })
}

const assignee = ref('')
watch(request, (r) => (assignee.value = r?.assignee?.id ?? ''), { immediate: true })
const assign = () => act('assign', { staffId: assignee.value || null })

const closed = computed(() => (request.value ? isSupportClosed(request.value.status) : true))
// Người nhận được giao: owner và bán hàng (có `support.handle`), tài khoản chưa khóa.
const assignable = computed(() =>
  staff.value.filter((s) => !s.locked && s.roles.some((role) => role === 'owner' || role === 'sales')),
)
const authorOf = (m: AdminSupportRequest['messages'][number]) =>
  m.author === 'staff' ? (m.staff?.name ?? 'Nhân viên') : m.author === 'customer' ? 'Khách' : 'Hệ thống'

await load()
if (canAssign.value) {
  try {
    staff.value = StaffList.parse(await session.adminFetch('/api/admin/staff')).items
  } catch {
    staff.value = []
  }
}
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Yêu cầu #YC{{ code }}</h1>
        <p v-if="request" class="admin-page-desc">
          {{ SUPPORT_KIND_LABELS[request.kind] }} · {{ request.subject }} · gửi lúc
          {{ formatDateTime(request.createdAt) }}
          <template v-if="request.createdBy === 'staff'"> · {{ request.createdByStaff?.name }} tạo hộ</template>
        </p>
      </div>
      <NuxtLink to="/admin/support" class="btn btn-secondary btn-sm">‹ Danh sách yêu cầu</NuxtLink>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div v-if="request" style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr); gap: 24px">
      <div>
        <div class="admin-panel" style="margin-bottom: 24px">
          <h2 class="admin-section-title">Trao đổi</h2>
          <div
            v-for="m in request.messages"
            :key="m.id"
            data-testid="admin-support-message"
            :style="{
              borderTop: '1px solid var(--adm-border)',
              padding: '12px 0',
              background: m.internal ? 'var(--adm-warning-bg, #fff8e6)' : undefined,
            }"
          >
            <div style="font-size: 12px; color: var(--adm-muted); margin-bottom: 4px">
              {{ authorOf(m) }} · {{ formatDateTime(m.createdAt) }}
              <strong v-if="m.internal" style="color: #b45309"> · Ghi chú nội bộ</strong>
            </div>
            <div style="white-space: pre-line; font-size: 13px">{{ m.body }}</div>
          </div>
        </div>

        <form v-if="canHandle && !closed" class="admin-panel" data-testid="admin-support-reply" @submit.prevent="send">
          <h2 class="admin-section-title">Trả lời</h2>
          <div class="form-group">
            <label class="form-label" for="support-reply-message">Nội dung</label>
            <textarea
              id="support-reply-message"
              v-model="reply.message"
              class="form-textarea"
              rows="4"
              maxlength="5000"
            />
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: center; margin-bottom: 12px">
            <label style="display: flex; gap: 6px; align-items: center; font-size: 13px">
              <input v-model="reply.internal" type="checkbox" data-testid="admin-support-internal" />
              Ghi chú nội bộ (khách không thấy, không gửi email)
            </label>
            <div class="form-group" style="margin: 0; min-width: 200px">
              <label class="form-label" for="support-reply-status" style="font-size: 12px">Chuyển trạng thái</label>
              <select id="support-reply-status" v-model="reply.status" class="form-select">
                <option value="">Giữ nguyên</option>
                <option value="in_progress">Đang xử lý</option>
                <option value="waiting_customer">Chờ khách</option>
                <option value="resolved">Đã xong</option>
                <option value="rejected">Từ chối</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            class="btn btn-primary btn-sm"
            data-testid="admin-support-send"
            :disabled="busy || (!reply.message.trim() && !reply.status) || (reply.internal && !reply.message.trim())"
          >
            Gửi
          </button>
        </form>
      </div>

      <div>
        <div class="admin-panel" style="margin-bottom: 24px">
          <h2 class="admin-section-title">Trạng thái</h2>
          <dl style="margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 13px">
            <dt style="color: var(--adm-muted)">Trạng thái</dt>
            <dd style="margin: 0" data-testid="admin-support-status">{{ SUPPORT_STATUS_LABELS[request.status] }}</dd>
            <dt style="color: var(--adm-muted)">Phụ trách</dt>
            <dd style="margin: 0" data-testid="admin-support-assignee">
              {{ request.assignee?.name ?? 'Chưa ai nhận' }}
            </dd>
            <dt style="color: var(--adm-muted)">Khách</dt>
            <dd style="margin: 0">
              {{ request.contactName ?? '—' }}<br />
              <span style="color: var(--adm-muted)">{{ request.contactEmail }}</span>
            </dd>
            <template v-if="request.orderCode">
              <dt style="color: var(--adm-muted)">Đơn</dt>
              <dd style="margin: 0">
                <NuxtLink :to="`/admin/orders/${request.orderCode}`">#{{ request.orderCode }}</NuxtLink>
              </dd>
            </template>
            <template v-if="request.previousRequestCode">
              <dt style="color: var(--adm-muted)">Tiếp theo</dt>
              <dd style="margin: 0">
                <NuxtLink :to="`/admin/support/${request.previousRequestCode}`"
                  >#YC{{ request.previousRequestCode }}</NuxtLink
                >
              </dd>
            </template>
          </dl>
          <button
            v-if="canHandle && !closed && !request.assignee"
            type="button"
            class="btn btn-primary btn-sm"
            style="margin-top: 12px"
            data-testid="admin-support-claim"
            :disabled="busy"
            @click="act('claim')"
          >
            Nhận việc
          </button>
          <form v-if="canAssign && !closed" style="margin-top: 12px" @submit.prevent="assign">
            <label class="form-label" for="support-assignee" style="font-size: 12px">Giao cho</label>
            <div style="display: flex; gap: 8px">
              <select id="support-assignee" v-model="assignee" class="form-select">
                <option value="">Chưa ai nhận</option>
                <option v-for="s in assignable" :key="s.id" :value="s.id">{{ s.name }}</option>
              </select>
              <button type="submit" class="btn btn-secondary btn-sm" :disabled="busy">Giao</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>
