<script setup lang="ts">
import {
  AdminCommitment,
  AdminCommitmentList,
  CommitmentTypeList,
  type AdminProductDocument,
  type CommitmentType,
} from '@ecommerce/shared'

/**
 * Cam kết có bằng chứng của một sản phẩm. Ai soạn sản phẩm cũng xem được; ghi cần `commitment.edit`.
 * Bảo hành chỉ hiện với khách qua đây (ADR 0005), và mỗi cam kết phải dựa trên chứng từ của chính sản phẩm.
 */
const props = defineProps<{
  productId: string
  /** Chứng từ của sản phẩm để chọn làm bằng chứng; rỗng khi người dùng không có `document.view`. */
  documents: AdminProductDocument[]
}>()

const session = useAdminSession()
const canEdit = session.can('commitment.edit')
const base = `/api/admin/products/${props.productId}/commitments`

type Draft = { typeId: string; statement: string; documentIds: string[] }
type Row = AdminCommitment & { draft: Draft }

const types = ref<CommitmentType[]>([])
const rows = ref<Row[]>([])
const fresh = ref<Draft>({ typeId: '', statement: '', documentIds: [] })
const error = ref<string | null>(null)

const KIND_LABELS = { warranty: 'Bảo hành', other: 'Khác' } as const

const toRow = (c: AdminCommitment): Row => ({
  ...c,
  draft: { typeId: c.typeId, statement: c.statement, documentIds: [...c.documentIds] },
})
const documentName = (id: string) => props.documents.find((d) => d.id === id)?.fileName ?? 'Chứng từ'

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
    const created = AdminCommitment.parse(await session.adminFetch(base, { method: 'POST', body: fresh.value }))
    rows.value.push(toRow(created))
    fresh.value = { typeId: '', statement: '', documentIds: [] }
  })
}

function save(row: Row) {
  return attempt(async () => {
    const updated = AdminCommitment.parse(
      await session.adminFetch(`${base}/${row.id}`, { method: 'PUT', body: row.draft }),
    )
    Object.assign(row, toRow(updated))
  })
}

function remove(row: Row) {
  if (!confirm(`Gỡ cam kết "${row.typeName}"? Khách sẽ không còn thấy cam kết này.`)) return
  return attempt(async () => {
    await session.adminFetch(`${base}/${row.id}`, { method: 'DELETE' })
    rows.value = rows.value.filter((r) => r.id !== row.id)
  })
}

const [typeList, commitmentList] = await Promise.all([
  session.adminFetch('/api/admin/commitment-types'),
  session.adminFetch(base),
])
types.value = CommitmentTypeList.parse(typeList).items
rows.value = AdminCommitmentList.parse(commitmentList).items.map(toRow)
</script>

<template>
  <section>
    <h2>Cam kết có bằng chứng</h2>
    <p>
      Khách thấy cam kết tách riêng khỏi thông tin nguồn gốc công bố. Mỗi cam kết phải dựa trên ít nhất một chứng từ của
      sản phẩm; bảo hành chỉ hiện với khách dưới dạng cam kết loại bảo hành.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="rows.length === 0">Sản phẩm chưa có cam kết nào.</p>
    <ul>
      <li v-for="row in rows" :key="row.id">
        <fieldset :disabled="!canEdit">
          <label>
            Loại
            <select v-model="row.draft.typeId">
              <option v-for="type in types" :key="type.id" :value="type.id">
                {{ type.name }} ({{ KIND_LABELS[type.kind] }})
              </option>
            </select>
          </label>
          <label>Nội dung cho khách <textarea v-model="row.draft.statement" maxlength="2000" /></label>
          <div>
            Bằng chứng:
            <template v-if="documents.length > 0">
              <label v-for="document in documents" :key="document.id">
                <input v-model="row.draft.documentIds" type="checkbox" :value="document.id" />
                {{ document.fileName }}
              </label>
            </template>
            <span v-else>{{ row.documentIds.map(documentName).join(', ') }}</span>
          </div>
          <template v-if="canEdit">
            <button type="button" @click="save(row)">Lưu cam kết</button>
            <button type="button" @click="remove(row)">Gỡ cam kết</button>
          </template>
        </fieldset>
      </li>
    </ul>

    <form v-if="canEdit" @submit.prevent="create">
      <h3>Thêm cam kết</h3>
      <p v-if="documents.length === 0">Tải chứng từ lên trước: không ghi được cam kết khi chưa có chứng từ.</p>
      <label>
        Loại
        <select v-model="fresh.typeId" required>
          <option value="" disabled>Chọn loại cam kết</option>
          <option v-for="type in types" :key="type.id" :value="type.id">
            {{ type.name }} ({{ KIND_LABELS[type.kind] }})
          </option>
        </select>
      </label>
      <label>Nội dung cho khách <textarea v-model="fresh.statement" required maxlength="2000" /></label>
      <div>
        Bằng chứng:
        <label v-for="document in documents" :key="document.id">
          <input v-model="fresh.documentIds" type="checkbox" :value="document.id" />
          {{ document.fileName }}
        </label>
      </div>
      <button type="submit" :disabled="fresh.documentIds.length === 0">Thêm cam kết</button>
    </form>
  </section>
</template>
