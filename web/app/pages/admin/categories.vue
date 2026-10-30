<script setup lang="ts">
import { AdminCategoryList, ProductType, type AdminCategory } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'catalog.edit' })

type Row = AdminCategory & { depth: number }

const session = useAdminSession()
const categories = ref<AdminCategory[]>([])
const error = ref<string | null>(null)
const showCreatePanel = ref(false)
const form = reactive({ name: '', slug: '', productType: 'footwear' as ProductType, parentId: null as string | null })
/** Danh mục đang sửa, trước khi bấm lưu. */
const editing = ref<{ id: string; name: string; slug: string; parentId: string | null } | null>(null)

/** Danh mục của từng nhóm hàng, xếp theo thứ tự duyệt cây kèm độ sâu để thụt lề. */
const tree = computed(() =>
  ProductType.options.map((productType) => {
    const rows: Row[] = []
    const visit = (parentId: string | null, depth: number) => {
      for (const category of categories.value) {
        if (category.productType !== productType || category.parentId !== parentId) continue
        rows.push({ ...category, depth })
        visit(category.id, depth + 1)
      }
    }
    visit(null, 0)
    return { productType, rows }
  }),
)

const rowsOf = (productType: ProductType) => tree.value.find((root) => root.productType === productType)!.rows

/** Cha hợp lệ cho danh mục `id`: cùng nhóm hàng, không phải chính nó hay nhánh con của nó. API vẫn kiểm lại. */
function parentOptions(productType: ProductType, id?: string) {
  const rows = rowsOf(productType)
  const start = rows.findIndex((row) => row.id === id)
  if (start === -1) return rows
  const end = rows.findIndex((row, i) => i > start && row.depth <= rows[start]!.depth)
  return rows.filter((_, i) => i < start || (end !== -1 && i >= end))
}

const indentSymbol = (depth: number) => (depth === 0 ? '' : '└── '.padStart(depth * 3 + 4, '　'))

// Danh mục còn con thì API từ chối xóa; khóa nút sẵn để khỏi bấm vô ích.
const hasChildren = (id: string) => categories.value.some((category) => category.parentId === id)

async function load() {
  categories.value = AdminCategoryList.parse(await session.adminFetch('/api/admin/categories')).items
}

/** Chạy một thao tác rồi tải lại danh sách; lỗi thì hiện thông báo từ API. */
async function run(action: () => Promise<unknown>) {
  error.value = null
  try {
    await action()
    await load()
    return true
  } catch (err) {
    error.value = apiErrorMessage(err)
    return false
  }
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

watch(
  () => form.name,
  (name) => {
    if (!form.slug || form.slug === slugify(name.slice(0, -1))) {
      form.slug = slugify(name)
    }
  },
)

async function create() {
  const ok = await run(() => session.adminFetch('/api/admin/categories', { method: 'POST', body: form }))
  if (ok) {
    Object.assign(form, { name: '', slug: '' })
    showCreatePanel.value = false
  }
}

function edit({ id, name, slug, parentId }: AdminCategory) {
  editing.value = { id, name, slug, parentId }
}

async function save() {
  const { id, ...body } = editing.value!
  if (await run(() => session.adminFetch(`/api/admin/categories/${id}`, { method: 'PUT', body }))) editing.value = null
}

function setHidden(id: string, hidden: boolean) {
  return run(() => session.adminFetch(`/api/admin/categories/${id}/${hidden ? 'hide' : 'unhide'}`, { method: 'POST' }))
}

function remove(category: AdminCategory) {
  if (!confirm(`Xóa danh mục "${category.name}"?`)) return
  return run(() => session.adminFetch(`/api/admin/categories/${category.id}`, { method: 'DELETE' }))
}

// Đổi nhóm hàng thì cha đang chọn không còn hợp lệ.
watch(
  () => form.productType,
  () => (form.parentId = null),
)

await load()
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Cây danh mục phân loại</h1>
        <p class="admin-page-desc">
          Gốc cây là 5 nhóm hàng cố định; danh mục con luôn cùng nhóm hàng với cha (ADR 0004). Ẩn danh mục sẽ gỡ danh
          mục đó và toàn bộ nhánh con khỏi menu của khách.
        </p>
      </div>

      <div class="admin-topbar-actions">
        <button type="button" class="btn btn-primary" @click="showCreatePanel = !showCreatePanel">
          <span>{{ showCreatePanel ? 'Đóng form' : '+ Thêm danh mục mới' }}</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div v-if="showCreatePanel" class="admin-panel" style="border-left: 3px solid var(--adm-dark)">
      <div class="admin-panel-header">
        <div>
          <h2 class="admin-section-title" style="margin: 0">Thêm danh mục mới</h2>
          <p class="form-help" style="margin-top: 2px">
            Nhóm hàng cố định từ lúc tạo và quyết định schema thuộc tính của toàn bộ sản phẩm bên dưới.
          </p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="showCreatePanel = false">✕ Đóng</button>
      </div>

      <form @submit.prevent="create">
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label" for="categories-form-product-type">Nhóm hàng gốc (Product Type) *</label>
            <select id="categories-form-product-type" v-model="form.productType" class="form-select" required>
              <option v-for="pt in ProductType.options" :key="pt" :value="pt">
                {{ PRODUCT_TYPE_LABELS[pt] }}
              </option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="categories-form-parent-id">Danh mục cha</label>
            <select id="categories-form-parent-id" v-model="form.parentId" class="form-select">
              <option :value="null">(Con trực tiếp của {{ PRODUCT_TYPE_LABELS[form.productType] }})</option>
              <option v-for="opt in rowsOf(form.productType)" :key="opt.id" :value="opt.id">
                {{ indentSymbol(opt.depth) }} {{ opt.name }}
              </option>
            </select>
          </div>
        </div>

        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label" for="categories-form-name">Tên danh mục *</label>
            <input
              id="categories-form-name"
              v-model="form.name"
              class="form-input"
              placeholder="Ví dụ: Sneaker cổ thấp, Túi xách đeo chéo..."
              required
            />
          </div>

          <div class="form-group">
            <label class="form-label" for="categories-form-slug">Slug URL *</label>
            <input
              id="categories-form-slug"
              v-model="form.slug"
              class="form-input"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="sneaker-co-thap"
              required
            />
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px">
          <button type="button" class="btn btn-secondary" @click="showCreatePanel = false">Hủy</button>
          <button type="submit" class="btn btn-primary">Tạo danh mục ›</button>
        </div>
      </form>
    </div>

    <div style="display: flex; flex-direction: column; gap: 24px">
      <div v-for="root in tree" :key="root.productType" class="admin-panel" style="padding: 0; overflow: hidden">
        <div
          style="padding: 16px 20px; background: var(--adm-surface-subtle); border-bottom: 1px solid var(--adm-border)"
        >
          <div style="display: flex; align-items: center; justify-content: space-between">
            <div style="display: flex; align-items: center; gap: 10px">
              <span class="badge badge-role" style="font-size: 11px">Gốc cây</span>
              <h2 class="admin-section-title" style="margin: 0; font-size: 16px">
                {{ PRODUCT_TYPE_LABELS[root.productType] }}
              </h2>
            </div>
            <span style="font-size: 12px; color: var(--adm-muted); font-weight: 500">
              {{ root.rows.length }} danh mục
            </span>
          </div>
        </div>

        <div
          v-if="!root.rows.length"
          style="padding: 32px; text-align: center; color: var(--adm-muted); font-size: 13px"
        >
          Chưa có danh mục nào trong nhóm {{ PRODUCT_TYPE_LABELS[root.productType] }}.
        </div>

        <table v-else class="admin-table">
          <thead>
            <tr>
              <th>Cấu trúc phân cấp & Tên danh mục</th>
              <th>Slug đường dẫn</th>
              <th>Trạng thái</th>
              <th style="text-align: right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in root.rows" :key="row.id">
              <template v-if="editing?.id === row.id">
                <td style="min-width: 260px">
                  <div style="display: flex; flex-direction: column; gap: 6px">
                    <input v-model="editing.name" class="form-input" placeholder="Tên danh mục" required />
                    <select v-model="editing.parentId" class="form-select" style="font-size: 12px">
                      <option :value="null">(Con trực tiếp của {{ PRODUCT_TYPE_LABELS[root.productType] }})</option>
                      <option v-for="opt in parentOptions(root.productType, row.id)" :key="opt.id" :value="opt.id">
                        {{ indentSymbol(opt.depth) }} {{ opt.name }}
                      </option>
                    </select>
                  </div>
                </td>
                <td>
                  <input v-model="editing.slug" class="form-input" required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
                </td>
                <td>
                  <span class="badge" :class="row.hidden ? 'badge-draft' : 'badge-published'">
                    {{ row.hidden ? 'Đang ẩn' : 'Hiển thị' }}
                  </span>
                </td>
                <td style="text-align: right">
                  <div style="display: flex; justify-content: flex-end; gap: 6px">
                    <button type="button" class="btn btn-primary btn-sm" @click="save">Lưu</button>
                    <button type="button" class="btn btn-secondary btn-sm" @click="editing = null">Hủy</button>
                  </div>
                </td>
              </template>

              <template v-else>
                <td>
                  <div style="display: flex; align-items: center">
                    <span
                      v-if="row.depth > 0"
                      style="
                        color: var(--adm-muted);
                        font-family: var(--adm-mono);
                        white-space: pre;
                        font-size: 12px;
                        margin-right: 6px;
                      "
                    >
                      {{ indentSymbol(row.depth) }}
                    </span>
                    <span style="font-weight: 600; font-size: 14px; color: var(--adm-ink)">{{ row.name }}</span>
                  </div>
                </td>
                <td>
                  <code style="font-family: var(--adm-mono); font-size: 12px; color: var(--adm-muted)">
                    /danh-muc/{{ row.slug }}
                  </code>
                </td>
                <td>
                  <span class="badge" :class="row.hidden ? 'badge-draft' : 'badge-published'">
                    <span class="badge-dot" />
                    {{ row.hidden ? 'Đang ẩn' : 'Hiển thị' }}
                  </span>
                </td>
                <td style="text-align: right">
                  <div style="display: flex; justify-content: flex-end; align-items: center; gap: 8px">
                    <button type="button" class="btn btn-secondary btn-sm" @click="setHidden(row.id, !row.hidden)">
                      {{ row.hidden ? 'Bỏ ẩn' : 'Ẩn' }}
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm" @click="edit(row)">Sửa</button>
                    <button
                      type="button"
                      class="btn btn-danger btn-sm"
                      :disabled="hasChildren(row.id)"
                      title="Không thể xóa danh mục đang có danh mục con"
                      @click="remove(row)"
                    >
                      Xóa
                    </button>
                  </div>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
