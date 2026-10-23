<script setup lang="ts">
import { CommitmentType, CommitmentTypeList, type CommitmentKind } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'commitment.edit' })

const KIND_LABELS: Record<CommitmentKind, string> = { warranty: 'Bảo hành', other: 'Khác' }

type Row = CommitmentType & { draftName: string; draftKind: CommitmentKind }

const session = useAdminSession()
const rows = ref<Row[]>([])
const fresh = ref<{ name: string; kind: CommitmentKind }>({ name: '', kind: 'other' })
const error = ref<string | null>(null)

const toRow = (type: CommitmentType): Row => ({ ...type, draftName: type.name, draftKind: type.kind })

async function attempt(action: () => Promise<unknown>) {
  error.value = null
  try {
    await action()
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function create() {
  return attempt(async () => {
    const body = fresh.value
    const created = CommitmentType.parse(
      await session.adminFetch('/api/admin/commitment-types', { method: 'POST', body }),
    )
    rows.value.push(toRow(created))
    fresh.value = { name: '', kind: 'other' }
  })
}

function save(row: Row) {
  return attempt(async () => {
    const body = { name: row.draftName, kind: row.draftKind }
    const updated = CommitmentType.parse(
      await session.adminFetch(`/api/admin/commitment-types/${row.id}`, { method: 'PUT', body }),
    )
    Object.assign(row, toRow(updated))
  })
}

rows.value = CommitmentTypeList.parse(await session.adminFetch('/api/admin/commitment-types')).items.map(toRow)
</script>

<template>
  <main>
    <h1>Loại cam kết</h1>
    <p>
      Danh sách các kiểu cam kết có bằng chứng doanh nghiệp được phép đưa ra. Loại "Bảo hành" là cách duy nhất để khách
      thấy bảo hành trên trang sản phẩm.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <table>
      <thead>
        <tr>
          <th>Tên</th>
          <th>Kiểu</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id">
          <td><input v-model="row.draftName" aria-label="Tên loại cam kết" maxlength="200" /></td>
          <td>
            <select v-model="row.draftKind" aria-label="Kiểu">
              <option v-for="(label, kind) in KIND_LABELS" :key="kind" :value="kind">{{ label }}</option>
            </select>
          </td>
          <td>
            <button
              type="button"
              :disabled="row.draftName === row.name && row.draftKind === row.kind"
              @click="save(row)"
            >
              Lưu
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <form @submit.prevent="create">
      <h2>Thêm loại cam kết</h2>
      <label>Tên <input v-model="fresh.name" required maxlength="200" /></label>
      <label>
        Kiểu
        <select v-model="fresh.kind">
          <option v-for="(label, kind) in KIND_LABELS" :key="kind" :value="kind">{{ label }}</option>
        </select>
      </label>
      <button type="submit">Thêm</button>
    </form>
  </main>
</template>
