<script setup lang="ts">
import {
  AdminBrandList,
  AdminCategoryList,
  AdminProduct,
  AdminProductList,
  AttributeSchema,
  type AdminBrand,
  type AdminCategory,
  type AttributeDefinition,
  type AttributeValue,
  type FieldError,
} from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: ['catalog.edit', 'price.edit'] })

const session = useAdminSession()
const canEdit = session.can('catalog.edit')
const products = ref<AdminProductList['items']>([])
const brands = ref<AdminBrand[]>([])
const categories = ref<AdminCategory[]>([])
const error = ref<string | null>(null)
const fieldErrors = ref<FieldError[]>([])
const form = reactive({
  brandId: '',
  categoryId: '',
  name: '',
  slug: '',
  attributes: {} as Record<string, AttributeValue | null>,
})
const definitions = ref<AttributeDefinition[]>([])

// Thuộc tính cấp sản phẩm bắt buộc phải có ngay lúc tạo, nên form sinh theo schema của nhóm hàng của danh mục.
watch(
  () => categories.value.find((c) => c.id === form.categoryId)?.productType,
  async (productType) => {
    form.attributes = {}
    definitions.value = productType
      ? AttributeSchema.parse(await session.adminFetch(`/api/attribute-schemas/${productType}`)).attributes.filter(
          (d) => d.level === 'product',
        )
      : []
  },
)

/** Sản phẩm mới chỉ có thông tin tối thiểu; nội dung và biến thể soạn tiếp ở trình soạn. */
async function create() {
  error.value = null
  fieldErrors.value = []
  try {
    const product = AdminProduct.parse(await session.adminFetch('/api/admin/products', { method: 'POST', body: form }))
    await navigateTo(`/admin/products/${product.id}`)
  } catch (err) {
    error.value = apiErrorMessage(err)
    fieldErrors.value = apiFieldErrors(err)
  }
}

const errorAt = (path: string) => fieldErrors.value.find((f) => f.path === path)?.message

const STATUS_LABELS = { draft: 'Nháp', published: 'Đã xuất bản', archived: 'Lưu trữ' } as const

products.value = AdminProductList.parse(await session.adminFetch('/api/admin/products')).items
// Thương hiệu và danh mục cần `catalog.edit`; người chỉ sửa giá không tạo sản phẩm nên không cần.
if (canEdit) {
  brands.value = AdminBrandList.parse(await session.adminFetch('/api/admin/brands')).items
  categories.value = AdminCategoryList.parse(await session.adminFetch('/api/admin/categories')).items
}
</script>

<template>
  <main>
    <h1>Sản phẩm</h1>
    <p v-if="error" role="alert">{{ error }}</p>

    <table>
      <thead>
        <tr>
          <th>Tên</th>
          <th>Mã mẫu</th>
          <th>Thương hiệu</th>
          <th>Danh mục</th>
          <th>Biến thể</th>
          <th>Trạng thái</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="product in products" :key="product.id">
          <td>
            <NuxtLink :to="`/admin/products/${product.id}`">{{ product.name }}</NuxtLink>
          </td>
          <td>{{ product.modelCode }}</td>
          <td>{{ product.brand.name }}</td>
          <td>{{ PRODUCT_TYPE_LABELS[product.productType] }} › {{ product.category.name }}</td>
          <td>{{ product.variantCount }}</td>
          <td>{{ STATUS_LABELS[product.status] }}</td>
        </tr>
      </tbody>
    </table>

    <template v-if="canEdit">
      <h2>Thêm sản phẩm</h2>
      <p>Sản phẩm mới luôn là nháp. Nhóm hàng lấy theo danh mục và không đổi được sau khi tạo.</p>
      <form @submit.prevent="create">
        <label>
          Thương hiệu
          <select v-model="form.brandId" required>
            <option v-for="brand in brands" :key="brand.id" :value="brand.id">{{ brand.name }}</option>
          </select>
        </label>
        <label>
          Danh mục
          <select v-model="form.categoryId" required>
            <option v-for="category in categories" :key="category.id" :value="category.id">
              {{ PRODUCT_TYPE_LABELS[category.productType] }} › {{ category.name }}
            </option>
          </select>
        </label>
        <label>Tên <input v-model="form.name" required /></label>
        <label>Slug <input v-model="form.slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label>
        <div v-for="definition in definitions" :key="definition.key">
          <label>
            {{ definition.label }}
            <AttributeInput v-model="form.attributes[definition.key]" :definition="definition" />
          </label>
          <small v-if="errorAt(`attributes.${definition.key}`)" role="alert">
            {{ errorAt(`attributes.${definition.key}`) }}
          </small>
        </div>
        <button type="submit">Tạo sản phẩm</button>
      </form>
    </template>
  </main>
</template>
