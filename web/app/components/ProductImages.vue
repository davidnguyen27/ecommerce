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
  if (skipped.length > 0) {
    error.value = `Không tải được: ${skipped.join(', ')}. Chỉ nhận jpeg, png, webp, tối đa ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`
  }
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files) void upload([...input.files]).then(() => (input.value = ''))
}

function onDropFiles(event: DragEvent) {
  dropActive.value = false
  if (event.dataTransfer?.files.length) void upload([...event.dataTransfer.files])
}

/** Thả ảnh đang kéo vào vị trí `index` rồi lưu thứ tự mới; lỗi thì nạp lại thứ tự trên server. */
function onDropRow(index: number) {
  const from = dragging.value
  dragging.value = null
  if (from === null || from === index) return
  const [moved] = rows.value.splice(from, 1)
  rows.value.splice(index, 0, moved!)
  return attempt(async () => {
    try {
      const body = { imageIds: rows.value.map((r) => r.id) }
      const list = AdminProductImageList.parse(await session.adminFetch(`${base}/order`, { method: 'PUT', body }))
      rows.value = list.items.map(toRow)
    } catch (err) {
      await load()
      throw err
    }
  })
}

function save(row: Row) {
  return attempt(async () => {
    const body = { alt: row.draftAlt, variantIds: row.draftVariantIds }
    const image = AdminProductImage.parse(await session.adminFetch(`${base}/${row.id}`, { method: 'PUT', body }))
    Object.assign(row, toRow(image))
  })
}

function remove(row: Row) {
  if (!confirm('Xóa ảnh này? File ảnh trên storage cũng bị xóa.')) return
  return attempt(async () => {
    await session.adminFetch(`${base}/${row.id}`, { method: 'DELETE' })
    rows.value = rows.value.filter((r) => r.id !== row.id)
  })
}

const isDirty = (row: Row) =>
  row.draftAlt !== row.alt || [...row.draftVariantIds].sort().join() !== [...row.variantIds].sort().join()

await load()
</script>

<template>
  <section>
    <h2>Ảnh</h2>
    <p>
      Ảnh đầu tiên là ảnh đại diện. Gắn ảnh vào biến thể để khi khách chọn biến thể đó (ví dụ một màu) thì ảnh đổi theo;
      ảnh không gắn biến thể nào là ảnh chung.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>

    <div
      v-if="canUpload"
      class="dropzone"
      :class="{ active: dropActive }"
      @dragover.prevent="dropActive = true"
      @dragleave="dropActive = false"
      @drop.prevent="onDropFiles"
    >
      <label>
        Kéo thả ảnh vào đây hoặc chọn file (jpeg, png, webp, tối đa {{ MAX_IMAGE_BYTES / 1024 / 1024 }} MB)
        <input type="file" multiple :accept="IMAGE_CONTENT_TYPES.join(',')" :disabled="!!uploading" @change="onPick" />
      </label>
      <p v-if="uploading" role="status">Đang tải {{ uploading }}…</p>
    </div>

    <p v-if="rows.length === 0">Sản phẩm chưa có ảnh.</p>
    <ol class="images">
      <li
        v-for="(row, index) in rows"
        :key="row.id"
        :draggable="canUpload"
        :class="{ dragging: dragging === index }"
        @dragstart="dragging = index"
        @dragend="dragging = null"
        @dragover.prevent
        @drop.prevent="onDropRow(index)"
      >
        <a :href="row.originalUrl" target="_blank" rel="noopener">
          <img :src="row.sizes[0]?.url" :alt="row.alt" width="120" />
        </a>
        <fieldset :disabled="!canUpload">
          <label>Alt text <input v-model="row.draftAlt" maxlength="500" placeholder="Mô tả ngắn nội dung ảnh" /></label>
          <div v-if="variants.length > 0">
            Biến thể:
            <label v-for="variant in variants" :key="variant.id">
              <input v-model="row.draftVariantIds" type="checkbox" :value="variant.id" />
              {{ variant.label }}
            </label>
          </div>
          <small>{{ row.width }} × {{ row.height }} px</small>
          <button type="button" :disabled="!isDirty(row)" @click="save(row)">Lưu ảnh</button>
          <button type="button" @click="remove(row)">Xóa ảnh</button>
        </fieldset>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.dropzone {
  border: 2px dashed currentColor;
  padding: 1rem;
}
.dropzone.active {
  background: rgba(0, 0, 0, 0.05);
}
.images li {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}
.images li[draggable='true'] {
  cursor: grab;
}
.images li.dragging {
  opacity: 0.5;
}
</style>
