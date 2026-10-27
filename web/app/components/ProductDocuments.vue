<script setup lang="ts">
import {
  AdminProductDocument,
  AdminProductDocumentList,
  DOCUMENT_CONTENT_TYPES,
  DocumentUrl,
  MAX_DOCUMENT_BYTES,
} from '@ecommerce/shared'
import { FileText, Upload, Trash2, ExternalLink, ShieldAlert } from 'lucide-vue-next'
import { Button } from '~/components/ui/button'
import { Alert, AlertDescription } from '~/components/ui/alert'

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
      <label>
        <Button variant="secondary" size="sm" as="span" class="cursor-pointer">
          <Upload class="size-3.5 mr-1" />
          <span>Tải chứng từ</span>
        </Button>
        <input
          type="file"
          multiple
          :accept="DOCUMENT_CONTENT_TYPES.join(',')"
          :disabled="!!uploading"
          class="hidden"
          @change="upload"
        />
      </label>
    </div>

    <Alert v-if="error" variant="destructive" class="mb-3">
      <ShieldAlert class="size-4" />
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <Alert v-if="uploading" variant="warning" class="mb-3">
      <AlertDescription>
        Đang tải lên: <strong>{{ uploading }}</strong
        >…
      </AlertDescription>
    </Alert>

    <div
      v-if="documents.length === 0"
      class="p-6 text-center text-xs text-muted-foreground bg-secondary/30 rounded-md border border-dashed border-border"
    >
      Chưa có chứng từ nào được đính kèm cho sản phẩm này.
    </div>

    <div v-else class="flex flex-col gap-2">
      <div
        v-for="document in documents"
        :key="document.id"
        class="flex items-center justify-between p-2.5 px-3.5 bg-secondary/30 border border-border rounded-md hover:bg-secondary/50 transition-colors"
      >
        <div class="min-w-0 flex items-center gap-2.5">
          <FileText class="size-4 text-muted-foreground shrink-0" />
          <span class="font-medium text-xs text-foreground truncate">
            {{ document.fileName }}
          </span>
          <span class="text-[11px] text-muted-foreground font-mono"> ({{ sizeLabel(document.sizeBytes) }}) </span>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" class="h-7 text-xs" @click="open(document)">
            <ExternalLink class="size-3 mr-1" />
            Xem (Ký URL)
          </Button>
          <Button variant="destructive" size="sm" class="h-7 text-xs" @click="remove(document)">
            <Trash2 class="size-3 mr-1" />
            Xóa
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
