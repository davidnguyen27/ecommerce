<script setup lang="ts">
import { AdminProductImage, AdminProductImageList, MAX_IMAGE_BYTES, IMAGE_CONTENT_TYPES } from '@ecommerce/shared'

/** Ảnh của một sản phẩm trong trình soạn: tải lên, kéo thả sắp thứ tự, alt text, gắn vào biến thể. */
const props = defineProps<{
  productId: string
  /** Biến thể đã lưu của sản phẩm, để gắn ảnh. */
  variants: { id: string; label: string }[]
}>()

const session = useAdminSession()
// Quyền thật do API kiểm; người không có `media.upload` chỉ xem.
const canUpload = session.can('media.upload')
const base = `/api/admin/products/${props.productId}/images`

/** Ảnh kèm bản đang soạn của alt text và biến thể. */
type Row = AdminProductImage & { draftAlt: string; draftVariantIds: string[] }

const rows = ref<Row[]>([])
const error = ref<string | null>(null)
const uploading = ref<string | null>(null)
const dragging = ref<number | null>(null)
const dropActive = ref(false)

function toRow(image: AdminProductImage): Row {
  return { ...image, draftAlt: image.alt, draftVariantIds: [...image.variantIds] }
}

async function load() {
  rows.value = AdminProductImageList.parse(await session.adminFetch(base)).items.map(toRow)
}

async function attempt(action: () => Promise<unknown>) {
  error.value = null
  try {
    await action()
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

/** Tải lần lượt từng file; file sai loại hoặc quá lớn bị bỏ qua ngay ở trình duyệt, API vẫn kiểm lại. */
async function upload(files: FileList | File[]) {
  error.value = null
  const skipped: string[] = []
  for (const file of files) {
    if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(file.type) || file.size > MAX_IMAGE_BYTES) {
      skipped.push(file.name)
      continue
    }
    uploading.value = file.name
    try {
      const body = new FormData()
      body.append('file', file)
      const image = AdminProductImage.parse(await session.adminFetch(base, { method: 'POST', body }))
      rows.value.push(toRow(image))
    } catch (err) {
      skipped.push(`${file.name} (${apiErrorMessage(err)})`)
    }
  }
  uploading.value = null
  error.value = skipped.length > 0 ? `Không tải được: ${skipped.join(', ')}` : null
}

function onDropFiles(event: DragEvent) {
  dropActive.value = false
  if (event.dataTransfer?.files?.length) void upload(event.dataTransfer.files)
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) void upload(input.files)
  input.value = ''
}

function isDirty(row: Row) {
  const altChanged = row.draftAlt !== row.alt
  const variantsChanged =
    row.draftVariantIds.length !== row.variantIds.length ||
    row.draftVariantIds.some((id) => !row.variantIds.includes(id))
  return altChanged || variantsChanged
}

function save(row: Row) {
  return attempt(async () => {
    const updated = AdminProductImage.parse(
      await session.adminFetch(`${base}/${row.id}`, {
        method: 'PUT',
        body: { alt: row.draftAlt, variantIds: row.draftVariantIds },
      }),
    )
    Object.assign(row, toRow(updated))
  })
}

function remove(row: Row) {
  if (!confirm('Xóa ảnh này khỏi sản phẩm?')) return
  return attempt(async () => {
    await session.adminFetch(`${base}/${row.id}`, { method: 'DELETE' })
    rows.value = rows.value.filter((r) => r.id !== row.id)
  })
}

function onDropRow(targetIndex: number) {
  if (dragging.value === null || dragging.value === targetIndex) return
  const from = dragging.value
  const item = rows.value.splice(from, 1)[0]!
  rows.value.splice(targetIndex, 0, item)
  dragging.value = null
  const imageIds = rows.value.map((r) => r.id)
  return attempt(async () => {
    await session.adminFetch(`${base}/order`, { method: 'PUT', body: { imageIds } })
  })
}

await load()
</script>

<template>
  <div class="admin-panel">
    <div class="admin-panel-header">
      <div>
        <h2 class="admin-section-title" style="margin: 0">Thư viện Hình ảnh Sản phẩm</h2>
        <p class="form-help" style="margin-top: 2px">
          Kéo thả để sắp xếp vị trí. Ảnh đầu tiên là ảnh đại diện. Có thể gán ảnh riêng cho từng biến thể SKU.
        </p>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert" style="margin-bottom: 12px">
      <span>{{ error }}</span>
    </div>

    <div
      v-if="canUpload"
      class="admin-dropzone"
      :class="{ active: dropActive }"
      @dragover.prevent="dropActive = true"
      @dragleave="dropActive = false"
      @drop.prevent="onDropFiles"
    >
      <label style="cursor: pointer; display: block; text-align: center">
        <div style="font-size: 20px; margin-bottom: 4px; opacity: 0.6">📷</div>
        <div style="font-weight: 600; font-size: 13px; color: var(--adm-ink)">
          Kéo thả ảnh vào đây, hoặc <span style="text-decoration: underline">chọn file từ máy</span>
        </div>
        <div class="form-help" style="font-size: 11px">
          Định dạng JPEG, PNG, WebP (Tối đa {{ MAX_IMAGE_BYTES / 1024 / 1024 }} MB). Tự động nén WebP đa kích thước.
        </div>
        <input
          type="file"
          multiple
          :accept="IMAGE_CONTENT_TYPES.join(',')"
          :disabled="!!uploading"
          style="display: none"
          @change="onPick"
        />
      </label>
      <p v-if="uploading" style="font-size: 12px; color: var(--adm-draft); text-align: center; margin-top: 8px">
        Đang xử lý & tải lên: <strong>{{ uploading }}</strong
        >…
      </p>
    </div>

    <div
      v-if="rows.length === 0"
      style="
        padding: 24px;
        text-align: center;
        color: var(--adm-muted);
        background: var(--adm-surface-subtle);
        border-radius: 6px;
        margin-top: 14px;
      "
    >
      Sản phẩm chưa có ảnh. Vui lòng tải ít nhất 1 ảnh trước khi xuất bản.
    </div>

    <div v-else style="display: flex; flex-direction: column; gap: 12px; margin-top: 16px">
      <div
        v-for="(row, index) in rows"
        :key="row.id"
        class="admin-image-card"
        :class="{ dragging: dragging === index }"
        :draggable="canUpload"
        @dragstart="dragging = index"
        @dragend="dragging = null"
        @dragover.prevent
        @drop.prevent="onDropRow(index)"
      >
        <div style="display: flex; gap: 14px; align-items: flex-start">
          <div style="position: relative">
            <a :href="row.originalUrl" target="_blank" rel="noopener">
              <img
                :src="row.sizes[0]?.url"
                :alt="row.alt"
                style="
                  width: 80px;
                  height: 80px;
                  object-fit: cover;
                  border-radius: 4px;
                  border: 1px solid var(--adm-border);
                "
              />
            </a>
            <span
              v-if="index === 0"
              class="badge badge-published"
              style="position: absolute; bottom: 4px; left: 4px; font-size: 9px; padding: 1px 4px"
            >
              Ảnh bìa
            </span>
          </div>

          <div style="flex: 1; min-width: 0">
            <div style="display: flex; justify-content: space-between; margin-bottom: 6px">
              <span style="font-size: 11px; color: var(--adm-muted); font-family: var(--adm-mono)">
                #{{ index + 1 }} · {{ row.width }} × {{ row.height }} px
              </span>
              <div style="display: flex; gap: 6px">
                <button type="button" class="btn btn-primary btn-sm" :disabled="!isDirty(row)" @click="save(row)">
                  Lưu
                </button>
                <button type="button" class="btn btn-danger btn-sm" @click="remove(row)">Xóa</button>
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 8px">
              <input
                v-model="row.draftAlt"
                class="form-input"
                style="padding: 4px 8px; font-size: 12px"
                maxlength="500"
                placeholder="Mô tả alt text ảnh..."
                :disabled="!canUpload"
              />
            </div>

            <div v-if="variants.length > 0" style="font-size: 12px">
              <span style="color: var(--adm-muted); font-size: 11px; display: block; margin-bottom: 4px"
                >Gắn với biến thể:</span
              >
              <div style="display: flex; flex-wrap: wrap; gap: 6px">
                <label
                  v-for="variant in variants"
                  :key="variant.id"
                  style="
                    font-size: 11px;
                    background: var(--adm-surface);
                    border: 1px solid var(--adm-border);
                    border-radius: 3px;
                    padding: 2px 6px;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                  "
                >
                  <input v-model="row.draftVariantIds" type="checkbox" :value="variant.id" :disabled="!canUpload" />
                  <span>{{ variant.label }}</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-dropzone {
  border: 1px dashed var(--adm-border);
  background-color: var(--adm-surface-subtle);
  border-radius: 6px;
  padding: 20px 16px;
  transition: all 0.15s ease;
}

.admin-dropzone.active {
  border-color: var(--adm-ink);
  background-color: var(--adm-surface-active);
}

.admin-image-card {
  background: var(--adm-surface-subtle);
  border: 1px solid var(--adm-border-subtle);
  border-radius: 6px;
  padding: 12px;
  transition: background 0.15s ease;
}

.admin-image-card[draggable='true'] {
  cursor: grab;
}

.admin-image-card.dragging {
  opacity: 0.4;
  border-style: dashed;
}
</style>
