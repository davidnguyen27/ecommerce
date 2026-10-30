<script setup lang="ts">
import {
  AdminProductDocument,
  AdminProductDocumentList,
  DOCUMENT_CONTENT_TYPES,
  DocumentUrl,
  MAX_DOCUMENT_BYTES,
} from '@ecommerce/shared'
import { ExternalLink, FileText, Trash2, Upload } from 'lucide-vue-next'

/** Chứng từ nguồn hàng private của một sản phẩm: tải lên, mở qua URL ký có hạn, xóa. Cần `document.view`. */
const props = defineProps<{ productId: string }>()
/** Trang cha dùng danh sách này để chọn chứng từ làm bằng chứng cho cam kết. */
const documents = defineModel<AdminProductDocument[]>({ required: true })

const session = useAdminSession()
const base = `/api/admin/products/${props.productId}/documents`

const error = ref<string | null>(null)
const uploading = ref<string | null>(null)

async function attempt(action: () => Promise<unknown>) {
  error.value = null
  try {
    await action()
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const skipped: string[] = []
  for (const file of input.files ?? []) {
    if (file.size > MAX_DOCUMENT_BYTES) {
      skipped.push(`${file.name} (quá ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB)`)
      continue
    }
    uploading.value = file.name
    try {
      const body = new FormData()
      body.append('file', file)
      documents.value.push(AdminProductDocument.parse(await session.adminFetch(base, { method: 'POST', body })))
    } catch (err) {
      skipped.push(`${file.name} (${apiErrorMessage(err)})`)
    }
  }
  uploading.value = null
  input.value = ''
  error.value = skipped.length > 0 ? `Không tải được: ${skipped.join(', ')}` : null
}

/** Mỗi lần mở là một lần cấp URL ký mới, được ghi audit. */
function open(document: AdminProductDocument) {
  const tab = window.open('', '_blank')
  return attempt(async () => {
    try {
      const { url } = DocumentUrl.parse(await session.adminFetch(`${base}/${document.id}/url`, { method: 'POST' }))
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch (err) {
      tab?.close()
      throw err
    }
  })
}

function remove(document: AdminProductDocument) {
  if (!confirm(`Xóa chứng từ ${document.fileName}?`)) return
  return attempt(async () => {
    await session.adminFetch(`${base}/${document.id}`, { method: 'DELETE' })
    documents.value = documents.value.filter((d) => d.id !== document.id)
  })
}

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`

documents.value = AdminProductDocumentList.parse(await session.adminFetch(base)).items
</script>

<template>
  <div class="admin-panel">
    <div class="admin-panel-header">
      <div>
        <h2 class="admin-section-title" style="margin: 0">Chứng từ nguồn hàng (Private R2)</h2>
        <p class="form-help" style="margin-top: 2px">
          Hóa đơn nhập, tờ khai hải quan. Tuyệt đối không công khai với khách; mỗi lần mở URL ký đều ghi Audit log.
        </p>
      </div>
      <label class="btn btn-secondary btn-sm" style="cursor: pointer">
        <Upload :size="14" aria-hidden="true" />
        <span>Tải chứng từ</span>
        <input
          type="file"
          multiple
          :accept="DOCUMENT_CONTENT_TYPES.join(',')"
          :disabled="!!uploading"
          style="display: none"
          @change="upload"
        />
      </label>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert" style="margin-bottom: 12px">
      <span>{{ error }}</span>
    </div>

    <p v-if="uploading" role="status" style="font-size: 12px; color: var(--adm-draft); margin-bottom: 12px">
      Đang tải lên: <strong>{{ uploading }}</strong
      >…
    </p>

    <div
      v-if="documents.length === 0"
      style="
        padding: 24px;
        text-align: center;
        color: var(--adm-muted);
        background: var(--adm-surface-subtle);
        border-radius: 6px;
      "
    >
      Chưa có chứng từ nào được đính kèm cho sản phẩm này.
    </div>

    <ul v-else style="display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none">
      <li
        v-for="document in documents"
        :key="document.id"
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 14px;
          background: var(--adm-surface-subtle);
          border: 1px solid var(--adm-border);
          border-radius: 6px;
        "
      >
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0">
          <FileText :size="16" style="flex-shrink: 0; color: var(--adm-muted)" aria-hidden="true" />
          <span
            style="font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
          >
            {{ document.fileName }}
          </span>
          <span style="font-size: 11px; color: var(--adm-muted); font-family: var(--adm-mono)">
            ({{ sizeLabel(document.sizeBytes) }})
          </span>
        </div>

        <div style="display: flex; gap: 6px; flex-shrink: 0">
          <button type="button" class="btn btn-secondary btn-sm" @click="open(document)">
            <ExternalLink :size="12" aria-hidden="true" />
            Xem (Ký URL)
          </button>
          <button type="button" class="btn btn-danger btn-sm" @click="remove(document)">
            <Trash2 :size="12" aria-hidden="true" />
            Xóa
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
