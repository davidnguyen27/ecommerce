<script setup lang="ts">
import {
  AdminProductDocument,
  AdminProductDocumentList,
  DOCUMENT_CONTENT_TYPES,
  DocumentUrl,
  MAX_DOCUMENT_BYTES,
} from '@ecommerce/shared'

/** Chứng từ nguồn hàng private của một sản phẩm: tải lên, mở qua URL ký có hạn, xóa. Cần `document.view`. */
const props = defineProps<{ productId: string }>()
const emit = defineEmits<{ change: [documents: AdminProductDocument[]] }>()

const session = useAdminSession()
const base = `/api/admin/products/${props.productId}/documents`

const documents = ref<AdminProductDocument[]>([])
const error = ref<string | null>(null)
const uploading = ref<string | null>(null)

watch(documents, (value) => emit('change', value), { deep: true })

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
  // Mở tab trước khi chờ API, để trình duyệt không chặn popup.
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
  <section>
    <h2>Chứng từ nguồn hàng</h2>
    <p>
      Hóa đơn nhập, giấy tờ nhà cung cấp. Chứng từ không bao giờ hiện với khách; mỗi lần mở đều được ghi vào audit log.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <label>
      Tải chứng từ (pdf, jpeg, png, webp, tối đa {{ MAX_DOCUMENT_BYTES / 1024 / 1024 }} MB)
      <input type="file" multiple :accept="DOCUMENT_CONTENT_TYPES.join(',')" :disabled="!!uploading" @change="upload" />
    </label>
    <p v-if="uploading" role="status">Đang tải {{ uploading }}…</p>
    <p v-if="documents.length === 0">Sản phẩm chưa có chứng từ.</p>
    <ul>
      <li v-for="document in documents" :key="document.id">
        {{ document.fileName }} <small>({{ sizeLabel(document.sizeBytes) }})</small>
        <button type="button" @click="open(document)">Mở</button>
        <button type="button" @click="remove(document)">Xóa</button>
      </li>
    </ul>
  </section>
</template>
