<script setup lang="ts">
import { StaffList, StaffRole, StaffSummary } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'staff.manage' })

const ROLE_LABELS: Record<StaffRole, string> = {
  owner: 'Chủ',
  sales: 'Bán hàng',
  warehouse: 'Kho',
  accountant: 'Kế toán',
}

const session = useAdminSession()
const staff = ref<StaffSummary[]>([])
/** Role đang chỉnh của từng nhân viên, trước khi bấm lưu. */
const draftRoles = ref<Record<string, StaffRole[]>>({})
/** Tên, email đang sửa của từng nhân viên, trước khi bấm lưu. */
const draftProfiles = ref<Record<string, { name: string; email: string }>>({})
const error = ref<string | null>(null)

const form = reactive({ email: '', name: '', password: '', roles: [] as StaffRole[] })

async function load() {
  staff.value = StaffList.parse(await session.adminFetch('/api/admin/staff')).items
  draftRoles.value = Object.fromEntries(staff.value.map((s) => [s.id, [...s.roles]]))
  draftProfiles.value = Object.fromEntries(staff.value.map((s) => [s.id, { name: s.name, email: s.email }]))
}

/** Chạy một thao tác rồi tải lại danh sách; lỗi thì hiện thông báo từ API. */
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
  if (ok) Object.assign(form, { email: '', name: '', password: '', roles: [] })
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
  <main>
    <h1>Nhân viên</h1>
    <p v-if="error" role="alert">{{ error }}</p>

    <table>
      <thead>
        <tr>
          <th>Tên</th>
          <th>Email</th>
          <th>Role</th>
          <th>Trạng thái</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in staff" :key="s.id">
          <td colspan="2">
            <form @submit.prevent="saveProfile(s.id)">
              <input v-model="draftProfiles[s.id]!.name" aria-label="Tên" required />
              <input v-model="draftProfiles[s.id]!.email" type="email" aria-label="Email" required />
              <button type="submit">Lưu tên, email</button>
            </form>
          </td>
          <td>
            <label v-for="role in StaffRole.options" :key="role">
              <input v-model="draftRoles[s.id]" type="checkbox" :value="role" />
              {{ ROLE_LABELS[role] }}
            </label>
            <button type="button" :disabled="!draftRoles[s.id]?.length" @click="saveRoles(s.id)">Lưu role</button>
          </td>
          <td>
            {{ s.locked ? 'Đã khóa' : 'Đang hoạt động' }}
            <button type="button" @click="setLocked(s.id, !s.locked)">{{ s.locked ? 'Mở khóa' : 'Khóa' }}</button>
          </td>
        </tr>
      </tbody>
    </table>

    <h2>Thêm nhân viên</h2>
    <form @submit.prevent="create">
      <label>Tên <input v-model="form.name" required /></label>
      <label>Email <input v-model="form.email" type="email" required /></label>
      <label>
        Mật khẩu ban đầu
        <input v-model="form.password" type="password" minlength="12" autocomplete="new-password" required />
      </label>
      <fieldset>
        <legend>Role</legend>
        <label v-for="role in StaffRole.options" :key="role">
          <input v-model="form.roles" type="checkbox" :value="role" />
          {{ ROLE_LABELS[role] }}
        </label>
      </fieldset>
      <button type="submit" :disabled="!form.roles.length">Tạo nhân viên</button>
    </form>
  </main>
</template>
