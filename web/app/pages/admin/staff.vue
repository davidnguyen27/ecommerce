<script setup lang="ts">
import { StaffList, StaffRole, StaffSummary } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'staff.manage' })

const ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Chủ sở hữu',
  sales: 'Bán hàng',
  warehouse: 'Thủ kho',
  accountant: 'Kế toán',
}

const session = useAdminSession()
const staff = ref<StaffSummary[]>([])
const draftRoles = ref<Record<string, StaffRole[]>>({})
const draftProfiles = ref<Record<string, { name: string; email: string }>>({})
const error = ref<string | null>(null)
const showCreatePanel = ref(false)

const form = reactive({ email: '', name: '', password: '', roles: [] as StaffRole[] })

async function load() {
  staff.value = StaffList.parse(await session.adminFetch('/api/admin/staff')).items
  draftRoles.value = Object.fromEntries(staff.value.map((s) => [s.id, [...s.roles]]))
  draftProfiles.value = Object.fromEntries(staff.value.map((s) => [s.id, { name: s.name, email: s.email }]))
}

async function run(action: () => Promise<unknown>) {
  error.value = null
  try {
    await action()
    await load()
    return true
  } catch (err) {
    error.value = apiErrorMessage(err)
    return false
  }
}

async function create() {
  const ok = await run(() => session.adminFetch('/api/admin/staff', { method: 'POST', body: form }))
  if (ok) {
    Object.assign(form, { email: '', name: '', password: '', roles: [] })
    showCreatePanel.value = false
  }
}

function saveProfile(id: string) {
  return run(() => session.adminFetch(`/api/admin/staff/${id}`, { method: 'PUT', body: draftProfiles.value[id] }))
}

function saveRoles(id: string) {
  return run(() =>
    session.adminFetch(`/api/admin/staff/${id}/roles`, { method: 'PUT', body: { roles: draftRoles.value[id] } }),
  )
}

function setLocked(id: string, locked: boolean) {
  return run(() => session.adminFetch(`/api/admin/staff/${id}/${locked ? 'lock' : 'unlock'}`, { method: 'POST' }))
}

await load()
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Nhân sự & Phân quyền</h1>
        <p class="admin-page-desc">
          Quản lý tài khoản nội bộ và vai trò truy cập (RBAC). Quyền hạn được tính toán lại theo từng request (ADR 0002)
          nên việc khóa tài khoản hoặc đổi vai trò có hiệu lực tức thì.
        </p>
      </div>

      <div class="admin-topbar-actions">
        <button type="button" class="btn btn-primary" @click="showCreatePanel = !showCreatePanel">
          <span>{{ showCreatePanel ? 'Đóng form' : '+ Thêm nhân viên mới' }}</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div v-if="showCreatePanel" class="admin-panel" style="border-left: 3px solid var(--adm-dark)">
      <div class="admin-panel-header">
        <div>
          <h2 class="admin-section-title" style="margin: 0">Khởi tạo tài khoản nhân viên</h2>
          <p class="form-help" style="margin-top: 2px">
            Nhân sự không thể tự đăng ký tài khoản. Chỉ chủ sở hữu có quyền tạo.
          </p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="showCreatePanel = false">✕ Đóng</button>
      </div>

      <form @submit.prevent="create">
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label" for="staff-form-name">Họ và tên nhân viên *</label>
            <input
              id="staff-form-name"
              v-model="form.name"
              class="form-input"
              placeholder="Ví dụ: Nguyễn Văn A"
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="staff-form-email">Email làm việc *</label>
            <input
              id="staff-form-email"
              v-model="form.email"
              type="email"
              class="form-input"
              placeholder="nhanvien@shop.vn"
              required
            />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="staff-form-password">Mật khẩu khởi tạo ban đầu (Tối thiểu 12 ký tự) *</label>
          <input
            id="staff-form-password"
            v-model="form.password"
            type="password"
            class="form-input"
            minlength="12"
            autocomplete="new-password"
            placeholder="••••••••••••"
            required
          />
        </div>

        <div class="form-group">
          <p class="form-label">Vai trò được giao (Chọn ít nhất 1 role) *</p>
          <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 6px">
            <label
              v-for="role in StaffRole.options"
              :key="role"
              style="
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-size: 13px;
                cursor: pointer;
                background: var(--adm-surface-subtle);
                padding: 6px 12px;
                border-radius: 6px;
                border: 1px solid var(--adm-border);
              "
            >
              <input v-model="form.roles" type="checkbox" :value="role" />
              <span style="font-weight: 500">{{ ROLE_LABELS[role] }}</span>
            </label>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px">
          <button type="button" class="btn btn-secondary" @click="showCreatePanel = false">Hủy</button>
          <button type="submit" class="btn btn-primary" :disabled="!form.roles.length">
            Tạo tài khoản nhân viên ›
          </button>
        </div>
      </form>
    </div>

    <div class="admin-table-card">
      <table class="admin-table">
        <thead>
          <tr>
            <th style="min-width: 240px">Thông tin nhân sự</th>
            <th style="min-width: 280px">Vai trò (Roles)</th>
            <th style="min-width: 140px">Trạng thái tài khoản</th>
            <th style="text-align: right">Khóa / Mở khóa</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in staff" :key="s.id">
            <td>
              <div style="display: flex; flex-direction: column; gap: 6px">
                <input
                  aria-label="Tên nhân viên"
                  v-model="draftProfiles[s.id]!.name"
                  class="form-input"
                  style="font-size: 13px; font-weight: 600; padding: 4px 8px"
                  placeholder="Tên"
                  required
                />
                <div style="display: flex; gap: 6px">
                  <input
                    aria-label="Email nhân viên"
                    v-model="draftProfiles[s.id]!.email"
                    type="email"
                    class="form-input"
                    style="font-size: 12px; font-family: var(--adm-mono); padding: 4px 8px"
                    placeholder="Email"
                    required
                  />
                  <button type="button" class="btn btn-secondary btn-sm" @click="saveProfile(s.id)">Lưu</button>
                </div>
              </div>
            </td>

            <td>
              <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center">
                <label
                  v-for="role in StaffRole.options"
                  :key="role"
                  style="
                    font-size: 12px;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    background: var(--adm-surface-subtle);
                    padding: 3px 8px;
                    border-radius: 4px;
                    border: 1px solid var(--adm-border);
                  "
                >
                  <input v-model="draftRoles[s.id]" type="checkbox" :value="role" />
                  <span>{{ ROLE_LABELS[role] }}</span>
                </label>
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  :disabled="!draftRoles[s.id]?.length"
                  @click="saveRoles(s.id)"
                >
                  Lưu role
                </button>
              </div>
            </td>

            <td>
              <span class="badge" :class="s.locked ? 'badge-archived' : 'badge-published'">
                <span class="badge-dot" />
                {{ s.locked ? 'Bị khóa' : 'Hoạt động' }}
              </span>
            </td>

            <td style="text-align: right">
              <button
                type="button"
                class="btn btn-sm"
                :class="s.locked ? 'btn-secondary' : 'btn-danger'"
                @click="setLocked(s.id, !s.locked)"
              >
                {{ s.locked ? 'Mở khóa' : 'Khóa tài khoản' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
