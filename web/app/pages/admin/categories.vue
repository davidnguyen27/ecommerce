<script setup lang="ts">
import { AdminCategoryList, ProductType, type AdminCategory } from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'catalog.edit' })

type Row = AdminCategory & { depth: number }

const session = useAdminSession()
const categories = ref<AdminCategory[]>([])
const error = ref<string | null>(null)
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

const indent = (row: Row) => '— '.repeat(row.depth)

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

async function create() {
  const ok = await run(() => session.adminFetch('/api/admin/categories', { method: 'POST', body: form }))
  if (ok) Object.assign(form, { name: '', slug: '' })
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
  <main>
    <h1>Danh mục</h1>
    <p>
      Gốc cây là năm nhóm hàng cố định; danh mục con luôn cùng nhóm hàng với cha. Ẩn danh mục gỡ nó và cả nhánh con khỏi
      menu và trang danh mục trên website; sản phẩm bên trong vẫn hiện ở nơi khác.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>

    <section v-for="root in tree" :key="root.productType">
      <h2>{{ PRODUCT_TYPE_LABELS[root.productType] }}</h2>
      <p v-if="!root.rows.length">Chưa có danh mục.</p>
      <table v-else>
        <thead>
          <tr>
            <th>Tên</th>
            <th>Slug</th>
            <th>Trạng thái</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in root.rows" :key="row.id">
            <template v-if="editing?.id === row.id">
              <td>
                <input v-model="editing.name" aria-label="Tên" required />
                <label>
                  Cha
                  <select v-model="editing.parentId">
                    <option :value="null">({{ PRODUCT_TYPE_LABELS[root.productType] }})</option>
                    <option
                      v-for="option in parentOptions(root.productType, row.id)"
                      :key="option.id"
                      :value="option.id"
                    >
                      {{ indent(option) }}{{ option.name }}
                    </option>
                  </select>
                </label>
              </td>
              <td><input v-model="editing.slug" aria-label="Slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></td>
              <td>{{ row.hidden ? 'Đang ẩn' : 'Đang hiển thị' }}</td>
              <td>
                <button type="button" @click="save">Lưu</button>
                <button type="button" @click="editing = null">Hủy</button>
              </td>
            </template>
            <template v-else>
              <td>{{ indent(row) }}{{ row.name }}</td>
              <td>{{ row.slug }}</td>
              <td>
                {{ row.hidden ? 'Đang ẩn' : 'Đang hiển thị' }}
                <button type="button" @click="setHidden(row.id, !row.hidden)">{{ row.hidden ? 'Bỏ ẩn' : 'Ẩn' }}</button>
              </td>
              <td>
                <button type="button" @click="edit(row)">Sửa</button>
                <button type="button" :disabled="hasChildren(row.id)" @click="remove(row)">Xóa</button>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </section>

    <h2>Thêm danh mục</h2>
    <form @submit.prevent="create">
      <label>Tên <input v-model="form.name" required /></label>
      <label>
        Slug
        <input v-model="form.slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="sneaker" />
      </label>
      <label>
        Nhóm hàng (không đổi được sau khi tạo)
        <select v-model="form.productType">
          <option v-for="productType in ProductType.options" :key="productType" :value="productType">
            {{ PRODUCT_TYPE_LABELS[productType] }}
          </option>
        </select>
      </label>
      <label>
        Cha
        <select v-model="form.parentId">
          <option :value="null">({{ PRODUCT_TYPE_LABELS[form.productType] }})</option>
          <option v-for="option in rowsOf(form.productType)" :key="option.id" :value="option.id">
            {{ indent(option) }}{{ option.name }}
          </option>
        </select>
      </label>
      <button type="submit">Tạo danh mục</button>
    </form>
  </main>
</template>
