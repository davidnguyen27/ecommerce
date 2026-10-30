<script setup lang="ts">
import { IMPORT_MAX_ROWS, ImportPreview, ImportResult } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'catalog.edit' })

const session = useAdminSession()
const file = ref<File | null>(null)
const preview = ref<ImportPreview | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

/** File mẫu sinh từ thương hiệu, danh mục và schema hiện tại; tải lại mỗi khi những thứ đó đổi. */
async function downloadTemplate() {
  error.value = null
  try {
    const blob = (await session.adminFetch('/api/admin/import/template', { responseType: 'blob' })) as Blob
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'mau-import-hang-hoa.xlsx'
    link.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    error.value = apiErrorMessage(err)
  }
}

function pickFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  preview.value = null
  notice.value = null
  error.value = null
}

const formData = () => {
  const body = new FormData()
  body.append('file', file.value!)
  return body
}

async function runPreview() {
  if (!file.value) return
  busy.value = true
  error.value = null
  try {
    preview.value = ImportPreview.parse(
      await session.adminFetch('/api/admin/import/preview', { method: 'POST', body: formData() }),
    )
  } catch (err) {
    error.value = apiErrorMessage(err)
  } finally {
    busy.value = false
  }
}

// Xác nhận gửi lại chính file đó; API kiểm lại từ đầu và chỉ ghi khi cả file hợp lệ.
async function commit() {
  if (!file.value) return
  busy.value = true
  error.value = null
  try {
    const result = ImportResult.parse(
      await session.adminFetch('/api/admin/import/commit', { method: 'POST', body: formData() }),
    )
    notice.value = `Đã tạo ${result.products} sản phẩm nháp với ${result.variants} biến thể, ghi tồn đầu kỳ cho ${result.openingStocks} biến thể. Hãy thêm ảnh và kiểm lại trước khi xuất bản.`
    preview.value = null
    file.value = null
  } catch (err) {
    error.value = apiErrorMessage(err)
    // Dữ liệu có thể đã đổi từ lúc xem trước: xem trước lại để hiện lỗi theo từng dòng.
    await runPreview()
  } finally {
    busy.value = false
  }
}

const canCommit = computed(
  () =>
    !!preview.value &&
    preview.value.errors.length === 0 &&
    (preview.value.variants > 0 || preview.value.openingStocks > 0),
)
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Import từ Excel</h1>
        <p class="admin-page-desc">
          Tạo sản phẩm nháp và biến thể hàng loạt từ file .xlsx (tối đa {{ IMPORT_MAX_ROWS }} dòng biến thể, 5 MB). Dòng
          có SKU đã tồn tại chỉ dùng để ghi tồn đầu kỳ (một lần cho mỗi biến thể); import không sửa sản phẩm đã có. Ảnh,
          bảng size, chính sách và cam kết thêm sau ở trang soạn sản phẩm.
        </p>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" @click="downloadTemplate">Tải file mẫu</button>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>
    <div v-if="notice" class="admin-alert admin-alert-success" role="status">
      <span>{{ notice }}</span>
      <NuxtLink to="/admin/products" style="margin-left: 8px; font-weight: 600">Xem sản phẩm</NuxtLink>
    </div>

    <div class="admin-panel" style="padding: 16px 20px; margin-bottom: 20px">
      <ol style="margin: 0 0 12px 18px; font-size: 13px; color: var(--adm-muted)">
        <li>Tải file mẫu: mỗi nhóm hàng một sheet, mỗi dòng là một biến thể, các dòng cùng slug thuộc một sản phẩm.</li>
        <li>Chọn file đã điền rồi bấm Xem trước: hệ thống kiểm cả file, chưa ghi gì.</li>
        <li>Không còn lỗi thì bấm Xác nhận: cả file được ghi một lần, có lỗi là không ghi dòng nào.</li>
      </ol>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
        <input
          aria-label="File Excel import"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="form-input"
          style="max-width: 360px"
          @change="pickFile"
        />
        <button type="button" class="btn btn-secondary btn-sm" :disabled="!file || busy" @click="runPreview">
          Xem trước
        </button>
        <button type="button" class="btn btn-primary btn-sm" :disabled="!canCommit || busy" @click="commit">
          Xác nhận import
        </button>
      </div>
    </div>

    <div v-if="preview" class="admin-panel" style="padding: 16px 20px">
      <p style="margin: 0 0 12px">
        Sẽ tạo <strong>{{ preview.products }}</strong> sản phẩm nháp với <strong>{{ preview.variants }}</strong> biến
        thể<template v-if="preview.openingStocks"
          >, ghi tồn đầu kỳ cho <strong>{{ preview.openingStocks }}</strong> biến thể</template
        >.
        <span v-if="preview.errors.length" style="color: #b91c1c">
          Còn {{ preview.errors.length }} lỗi; sửa file rồi xem trước lại.
        </span>
      </p>
      <div
        v-for="group in [
          { title: 'Lỗi', items: preview.errors },
          { title: 'Cảnh báo', items: preview.warnings },
        ]"
        :key="group.title"
      >
        <template v-if="group.items.length">
          <h3 style="font-size: 14px; margin: 12px 0 6px">{{ group.title }} ({{ group.items.length }})</h3>
          <div style="overflow-x: auto">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Sheet</th>
                  <th class="admin-table-num">Dòng</th>
                  <th>Cột</th>
                  <th>Nội dung</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, index) in group.items" :key="index">
                  <td>{{ item.sheet }}</td>
                  <td class="admin-table-num">{{ item.row ?? '—' }}</td>
                  <td>{{ item.column ?? '—' }}</td>
                  <td>{{ item.message }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
