<script setup lang="ts">
import { CommitmentType, CommitmentTypeList, type CommitmentKind } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'commitment.edit' })

type Row = CommitmentType & { draftName: string; draftKind: CommitmentKind }

const session = useAdminSession()
const rows = ref<Row[]>([])
const fresh = ref<{ name: string; kind: CommitmentKind }>({ name: '', kind: 'other' })
const error = ref<string | null>(null)
const showCreatePanel = ref(false)

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
    showCreatePanel.value = false
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
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Loại cam kết có bằng chứng</h1>
        <p class="admin-page-desc">
          Danh mục định nghĩa các kiểu cam kết được phép công bố trên sản phẩm (ADR 0005). Kiểu "Bảo hành" là phương
          thức duy nhất để kích hoạt huy hiệu bảo hành chính hãng có căn cứ cho khách hàng.
        </p>
      </div>

      <div class="admin-topbar-actions">
        <button type="button" class="btn btn-primary" @click="showCreatePanel = !showCreatePanel">
          <span>{{ showCreatePanel ? 'Đóng form' : '+ Thêm loại cam kết' }}</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div v-if="showCreatePanel" class="admin-panel" style="border-left: 3px solid var(--adm-dark)">
      <div class="admin-panel-header">
        <div>
          <h2 class="admin-section-title" style="margin: 0">Thêm loại cam kết mới</h2>
          <p class="form-help" style="margin-top: 2px">
            Chỉ người có quyền quản trị cam kết (Owner) mới được cấp quyền này.
          </p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="showCreatePanel = false">✕ Đóng</button>
      </div>

      <form @submit.prevent="create">
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label" for="commitment-types-fresh-name">Tên loại cam kết *</label>
            <input
              id="commitment-types-fresh-name"
              v-model="fresh.name"
              class="form-input"
              placeholder="Ví dụ: Bảo hành chính hãng 24 tháng"
              required
              maxlength="200"
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="commitment-types-fresh-kind">Phân loại cam kết *</label>
            <select id="commitment-types-fresh-kind" v-model="fresh.kind" class="form-select">
              <option v-for="(label, kind) in COMMITMENT_KIND_LABELS" :key="kind" :value="kind">{{ label }}</option>
            </select>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px">
          <button type="button" class="btn btn-secondary" @click="showCreatePanel = false">Hủy</button>
          <button type="submit" class="btn btn-primary">Tạo loại cam kết ›</button>
        </div>
      </form>
    </div>

    <div class="admin-table-card">
      <table class="admin-table">
        <thead>
          <tr>
            <th>Tên loại cam kết</th>
            <th>Phân loại</th>
            <th style="text-align: right">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id">
            <td>
              <input
                v-model="row.draftName"
                class="form-input"
                style="font-size: 13px; font-weight: 500; padding: 4px 8px; max-width: 320px"
                aria-label="Tên loại cam kết"
                maxlength="200"
              />
            </td>
            <td>
              <select
                v-model="row.draftKind"
                class="form-select"
                style="font-size: 12px; padding: 4px 8px; max-width: 200px"
                aria-label="Kiểu"
              >
                <option v-for="(label, kind) in COMMITMENT_KIND_LABELS" :key="kind" :value="kind">{{ label }}</option>
              </select>
            </td>
            <td style="text-align: right">
              <button
                type="button"
                class="btn btn-primary btn-sm"
                :disabled="row.draftName === row.name && row.draftKind === row.kind"
                @click="save(row)"
              >
                Lưu thay đổi
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
