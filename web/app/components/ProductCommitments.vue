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
  <div class="admin-panel">
    <div class="admin-panel-header">
      <div>
        <h2 class="admin-section-title" style="margin: 0">Cam kết có bằng chứng (Bảo hành)</h2>
        <p class="form-help" style="margin-top: 2px">
          Cam kết hiển thị độc lập với thông tin tự công bố. Bắt buộc gắn kèm chứng từ đối tác làm bằng chứng (ADR
          0005).
        </p>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert" style="margin-bottom: 12px">
      <span>{{ error }}</span>
    </div>

    <div
      v-if="rows.length === 0"
      style="
        padding: 24px;
        text-align: center;
        color: var(--adm-muted);
        background: var(--adm-surface-subtle);
        border-radius: 6px;
        margin-bottom: 16px;
      "
    >
      Sản phẩm chưa có cam kết xác thực nào.
    </div>

    <!-- Danh sách cam kết hiện có -->
    <div v-else style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px">
      <div
        v-for="row in rows"
        :key="row.id"
        style="
          padding: 16px;
          background: var(--adm-surface-subtle);
          border: 1px solid var(--adm-border-subtle);
          border-radius: 6px;
        "
      >
        <fieldset :disabled="!canEdit" style="border: none; padding: 0; margin: 0">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px">
            <span class="badge badge-published" style="font-size: 11px">
              {{ row.typeName }}
            </span>

            <div v-if="canEdit" style="display: flex; gap: 6px">
              <button type="button" class="btn btn-secondary btn-sm" @click="save(row)">Lưu</button>
              <button type="button" class="btn btn-danger btn-sm" @click="remove(row)">Gỡ</button>
            </div>
          </div>

          <div class="form-group" style="margin-bottom: 10px">
            <label class="form-label">Loại cam kết</label>
            <select v-model="row.draft.typeId" class="form-select">
              <option v-for="t in types" :key="t.id" :value="t.id">
                {{ t.name }} ({{ COMMITMENT_KIND_LABELS[t.kind] }})
              </option>
            </select>
          </div>

          <div class="form-group" style="margin-bottom: 10px">
            <label class="form-label">Nội dung hiển thị cho khách hàng</label>
            <textarea v-model="row.draft.statement" class="form-textarea" rows="2" maxlength="2000" />
          </div>

          <div>
            <label class="form-label" style="margin-bottom: 4px">Chứng từ làm căn cứ:</label>
            <div v-if="documents.length > 0" style="display: flex; flex-wrap: wrap; gap: 8px">
              <label
                v-for="doc in documents"
                :key="doc.id"
                style="
                  font-size: 12px;
                  background: var(--adm-surface);
                  border: 1px solid var(--adm-border);
                  border-radius: 4px;
                  padding: 3px 8px;
                  cursor: pointer;
                  display: inline-flex;
                  align-items: center;
                  gap: 6px;
                "
              >
                <input v-model="row.draft.documentIds" type="checkbox" :value="doc.id" />
                <span>{{ doc.fileName }}</span>
              </label>
            </div>
            <div v-else style="font-size: 12px; color: var(--adm-muted)">
              {{ row.documentIds.map(documentName).join(', ') || 'Không có chứng từ' }}
            </div>
          </div>
        </fieldset>
      </div>
    </div>

    <!-- Form Thêm cam kết mới -->
    <div v-if="canEdit" style="padding-top: 16px; border-top: 1px solid var(--adm-border-subtle)">
      <h3 style="font-size: 14px; font-weight: 600; margin: 0 0 10px 0; color: var(--adm-ink)">+ Thêm cam kết mới</h3>

      <div
        v-if="documents.length === 0"
        class="admin-alert admin-alert-warn"
        style="font-size: 12px; margin-bottom: 12px"
      >
        <span>Vui lòng tải ít nhất 1 chứng từ nguồn hàng trước khi tạo cam kết bảo hành.</span>
      </div>

      <form @submit.prevent="create">
        <div class="form-group">
          <label class="form-label">Loại cam kết *</label>
          <select v-model="fresh.typeId" class="form-select" required>
            <option value="" disabled>-- Chọn loại cam kết --</option>
            <option v-for="t in types" :key="t.id" :value="t.id">
              {{ t.name }} ({{ COMMITMENT_KIND_LABELS[t.kind] }})
            </option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Tuyên bố cam kết cho khách hàng *</label>
          <textarea
            v-model="fresh.statement"
            class="form-textarea"
            rows="2"
            required
            maxlength="2000"
            placeholder="Ví dụ: Bảo hành máy chính hãng 24 tháng theo chứng từ xuất xưởng."
          />
        </div>

        <div class="form-group">
          <label class="form-label">Chứng từ làm căn cứ xác minh (Chọn ít nhất 1) *</label>
          <div v-if="documents.length > 0" style="display: flex; flex-wrap: wrap; gap: 8px">
            <label
              v-for="doc in documents"
              :key="doc.id"
              style="
                font-size: 12px;
                background: var(--adm-surface-subtle);
                border: 1px solid var(--adm-border);
                border-radius: 4px;
                padding: 4px 8px;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 6px;
              "
            >
              <input v-model="fresh.documentIds" type="checkbox" :value="doc.id" />
              <span>{{ doc.fileName }}</span>
            </label>
          </div>
          <div v-else style="font-size: 12px; color: var(--adm-muted)">Chưa có chứng từ khả dụng.</div>
        </div>

        <button type="submit" class="btn btn-primary btn-sm" :disabled="fresh.documentIds.length === 0">
          Thêm cam kết bảo hành
        </button>
      </form>
    </div>
  </div>
</template>
