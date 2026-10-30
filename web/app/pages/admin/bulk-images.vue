<script setup lang="ts">
import { BulkImageResult } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'media.upload' })

type Outcome =
  { fileName: string; ok: true; result: BulkImageResult } | { fileName: string; ok: false; message: string }

const session = useAdminSession()
const files = ref<File[]>([])
const outcomes = ref<Outcome[]>([])
const running = ref(false)

/** `<SKU>_<n>.jpg` → SKU và số thứ tự; không có `_<n>` thì là 0. API tự xử lý SKU có dấu gạch dưới. */
function orderKey(file: File) {
  const stem = file.name.replace(/\.[^.]+$/, '').toUpperCase()
  const match = /^(.*)_(\d+)$/.exec(stem)
  return match ? { sku: match[1]!, n: Number(match[2]) } : { sku: stem, n: 0 }
}

function pickFiles(event: Event) {
  // API nối mỗi ảnh vào sau ảnh có sẵn, nên gửi theo SKU rồi theo số thứ tự để ảnh của một SKU đúng thứ tự.
  files.value = [...((event.target as HTMLInputElement).files ?? [])].sort((a, b) => {
    const ka = orderKey(a)
    const kb = orderKey(b)
    return ka.sku.localeCompare(kb.sku) || ka.n - kb.n
  })
  outcomes.value = []
}

async function uploadAll() {
  running.value = true
  outcomes.value = []
  // Gửi lần lượt từng file: mỗi file độc lập, file lỗi không chặn các file khác.
  for (const file of files.value) {
    const body = new FormData()
    body.append('file', file)
    try {
      const result = BulkImageResult.parse(
        await session.adminFetch('/api/admin/images/by-sku', { method: 'POST', body }),
      )
      outcomes.value.push({ fileName: file.name, ok: true, result })
    } catch (err) {
      outcomes.value.push({ fileName: file.name, ok: false, message: apiErrorMessage(err) })
    }
  }
  running.value = false
}

const failed = computed(() => outcomes.value.filter((o) => !o.ok))
const succeeded = computed(() => outcomes.value.filter((o) => o.ok))
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Ảnh hàng loạt</h1>
        <p class="admin-page-desc">
          Đặt tên file theo SKU: <code>AM90-DEN-40.jpg</code>, <code>AM90-DEN-40_2.jpg</code>… Mỗi ảnh được gắn vào sản
          phẩm của SKU đó và gắn với chính biến thể đó, nối sau các ảnh đang có. File không khớp SKU nào được bỏ qua.
        </p>
      </div>
    </div>

    <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
        <input
          aria-label="Chọn ảnh đặt tên theo SKU"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          class="form-input"
          style="max-width: 360px"
          :disabled="running"
          @change="pickFiles"
        />
        <button
          type="button"
          class="btn btn-primary btn-sm"
          :disabled="files.length === 0 || running"
          @click="uploadAll"
        >
          Tải lên {{ files.length }} ảnh
        </button>
        <span v-if="running || outcomes.length" style="font-size: 12px; color: var(--adm-muted)">
          Đã xử lý {{ outcomes.length }} / {{ files.length }}
        </span>
      </div>
    </div>

    <div v-if="!running && outcomes.length" class="admin-panel" style="padding: 16px 20px">
      <p style="margin: 0 0 12px">
        Thành công <strong>{{ succeeded.length }}</strong
        >, lỗi <strong :style="{ color: failed.length ? '#b91c1c' : undefined }">{{ failed.length }}</strong
        >.
      </p>
      <div style="overflow-x: auto">
        <table class="admin-table">
          <thead>
            <tr>
              <th>File</th>
              <th>Kết quả</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in [...failed, ...succeeded]" :key="o.fileName">
              <td style="font-family: var(--adm-mono); font-size: 12px">{{ o.fileName }}</td>
              <td v-if="o.ok">
                Đã gắn vào
                <NuxtLink :to="`/admin/products/${o.result.productId}`" style="font-weight: 600">
                  {{ o.result.sku }}
                </NuxtLink>
              </td>
              <td v-else style="color: #b91c1c">{{ o.message }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
