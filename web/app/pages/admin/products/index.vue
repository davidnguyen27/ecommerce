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

const showCreateDrawer = ref(false)
const filterStatus = ref<'all' | 'published' | 'draft' | 'archived'>('all')
const searchQuery = ref('')

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

// Tự động sinh slug từ tên sản phẩm nếu slug chưa bị người dùng sửa
watch(
  () => form.name,
  (name) => {
    if (!form.slug || form.slug === slugify(name.slice(0, -1))) {
      form.slug = slugify(name)
    }
  },
)

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Sản phẩm mới chỉ có thông tin tối thiểu; nội dung và biến thể soạn tiếp ở trình soạn. */
async function create() {
  error.value = null
  fieldErrors.value = []
  try {
    const product = AdminProduct.parse(await session.adminFetch('/api/admin/products', { method: 'POST', body: form }))
    showCreateDrawer.value = false
    await navigateTo(`/admin/products/${product.id}`)
  } catch (err) {
    error.value = apiErrorMessage(err)
    fieldErrors.value = apiFieldErrors(err)
  }
}

const errorAt = (path: string) => fieldErrors.value.find((f) => f.path === path)?.message

products.value = AdminProductList.parse(await session.adminFetch('/api/admin/products')).items
if (canEdit) {
  brands.value = AdminBrandList.parse(await session.adminFetch('/api/admin/brands')).items
  categories.value = AdminCategoryList.parse(await session.adminFetch('/api/admin/categories')).items
}

// Lọc sản phẩm theo trạng thái và từ khóa tìm kiếm
const filteredProducts = computed(() => {
  return products.value.filter((p) => {
    const matchStatus = filterStatus.value === 'all' || p.status === filterStatus.value
    const q = searchQuery.value.trim().toLowerCase()
    const matchQuery =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.modelCode.toLowerCase().includes(q) ||
      p.brand.name.toLowerCase().includes(q) ||
      p.category.name.toLowerCase().includes(q)
    return matchStatus && matchQuery
  })
})

const counts = computed(() => ({
  all: products.value.length,
  published: products.value.filter((p) => p.status === 'published').length,
  draft: products.value.filter((p) => p.status === 'draft').length,
  archived: products.value.filter((p) => p.status === 'archived').length,
}))
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Sản phẩm</h1>
        <p class="admin-page-desc">
          Quản lý danh mục hàng hiệu, soạn thảo biến thể, kiểm soát giá bán và phát hành phiên bản snapshot công khai.
        </p>
      </div>

      <div v-if="canEdit" class="admin-topbar-actions">
        <button type="button" class="btn btn-primary" @click="showCreateDrawer = !showCreateDrawer">
          <span>{{ showCreateDrawer ? 'Đóng form' : '+ Thêm sản phẩm mới' }}</span>
        </button>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div v-if="showCreateDrawer && canEdit" class="admin-panel" style="border-left: 3px solid var(--adm-dark)">
      <div class="admin-panel-header">
        <div>
          <h2 class="admin-section-title" style="margin: 0">Khởi tạo bản thảo sản phẩm mới</h2>
          <p class="form-help" style="margin-top: 2px">
            Sản phẩm khởi tạo luôn ở trạng thái <strong>Nháp</strong>. Nhóm hàng cố định theo danh mục ban đầu và không
            thể thay đổi sau khi tạo.
          </p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" @click="showCreateDrawer = false">✕ Đóng</button>
      </div>

      <form @submit.prevent="create">
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label" for="products-form-brand-id">Thương hiệu *</label>
            <select id="products-form-brand-id" v-model="form.brandId" class="form-select" required>
              <option value="" disabled>-- Chọn thương hiệu --</option>
              <option v-for="brand in brands" :key="brand.id" :value="brand.id">{{ brand.name }}</option>
            </select>
            <small v-if="errorAt('brandId')" class="field-error-msg">{{ errorAt('brandId') }}</small>
          </div>

          <div class="form-group">
            <label class="form-label" for="products-form-category-id">Danh mục phân loại *</label>
            <select id="products-form-category-id" v-model="form.categoryId" class="form-select" required>
              <option value="" disabled>-- Chọn danh mục --</option>
              <option v-for="category in categories" :key="category.id" :value="category.id">
                {{ PRODUCT_TYPE_LABELS[category.productType] }} › {{ category.name }}
              </option>
            </select>
            <small v-if="errorAt('categoryId')" class="field-error-msg">{{ errorAt('categoryId') }}</small>
          </div>
        </div>

        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label" for="products-form-name">Tên sản phẩm *</label>
            <input
              id="products-form-name"
              v-model="form.name"
              class="form-input"
              placeholder="Ví dụ: Giày Sneaker Ace Leather"
              required
            />
            <small v-if="errorAt('name')" class="field-error-msg">{{ errorAt('name') }}</small>
          </div>

          <div class="form-group">
            <label class="form-label" for="products-form-slug">Slug đường dẫn (URL) *</label>
            <input
              id="products-form-slug"
              v-model="form.slug"
              class="form-input"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              placeholder="giay-sneaker-ace-leather"
              required
            />
            <small v-if="errorAt('slug')" class="field-error-msg">{{ errorAt('slug') }}</small>
          </div>
        </div>

        <div
          v-if="definitions.length > 0"
          style="margin-top: 10px; padding-top: 16px; border-top: 1px solid var(--adm-border-subtle)"
        >
          <div style="font-size: 13px; font-weight: 600; margin-bottom: 12px; color: var(--adm-ink)">
            Thuộc tính bắt buộc cấp sản phẩm:
          </div>
          <div class="form-grid-2">
            <div v-for="definition in definitions" :key="definition.key" class="form-group">
              <label class="form-label" :for="`new-product-attr-${definition.key}`">{{ definition.label }}</label>
              <AttributeInput
                :id="`new-product-attr-${definition.key}`"
                v-model="form.attributes[definition.key]"
                :definition="definition"
              />
              <small v-if="errorAt(`attributes.${definition.key}`)" class="field-error-msg">
                {{ errorAt(`attributes.${definition.key}`) }}
              </small>
            </div>
          </div>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px">
          <button type="button" class="btn btn-secondary" @click="showCreateDrawer = false">Hủy</button>
          <button type="submit" class="btn btn-primary">Tạo bản thảo & Tiếp tục soạn ›</button>
        </div>
      </form>
    </div>

    <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px">
      <div class="tab-filter-bar" style="margin-bottom: 0">
        <button
          type="button"
          class="tab-filter-btn"
          :class="{ active: filterStatus === 'all' }"
          @click="filterStatus = 'all'"
        >
          Tất cả ({{ counts.all }})
        </button>
        <button
          type="button"
          class="tab-filter-btn"
          :class="{ active: filterStatus === 'published' }"
          @click="filterStatus = 'published'"
        >
          Đang bán ({{ counts.published }})
        </button>
        <button
          type="button"
          class="tab-filter-btn"
          :class="{ active: filterStatus === 'draft' }"
          @click="filterStatus = 'draft'"
        >
          Bản nháp ({{ counts.draft }})
        </button>
        <button
          type="button"
          class="tab-filter-btn"
          :class="{ active: filterStatus === 'archived' }"
          @click="filterStatus = 'archived'"
        >
          Lưu trữ ({{ counts.archived }})
        </button>
      </div>

      <div>
        <input
          v-model="searchQuery"
          type="search"
          class="form-input"
          style="width: 260px; padding: 6px 12px"
          placeholder="Lọc tên, mã mẫu, hãng..."
        />
      </div>
    </div>

    <div class="admin-table-card" style="margin-top: 16px">
      <div v-if="filteredProducts.length === 0" style="padding: 40px; text-align: center; color: var(--adm-muted)">
        Không tìm thấy sản phẩm nào phù hợp với bộ lọc hiện tại.
      </div>

      <table v-else class="admin-table">
        <thead>
          <tr>
            <th>Tên sản phẩm</th>
            <th>Mã mẫu</th>
            <th>Thương hiệu</th>
            <th>Phân loại danh mục</th>
            <th class="admin-table-num">Số biến thể</th>
            <th>Trạng thái</th>
            <th style="text-align: right">Thao tác</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="product in filteredProducts" :key="product.id">
            <td>
              <NuxtLink :to="`/admin/products/${product.id}`" style="display: block; font-size: 14px">
                {{ product.name }}
              </NuxtLink>
              <span style="font-size: 11px; color: var(--adm-muted); font-family: var(--adm-mono)">
                /{{ product.slug }}
              </span>
            </td>
            <td>
              <span v-if="product.modelCode" style="font-family: var(--adm-mono); font-size: 12px">
                {{ product.modelCode }}
              </span>
              <span v-else style="color: var(--adm-muted); font-size: 12px">—</span>
            </td>
            <td>
              <span style="font-weight: 500">{{ product.brand.name }}</span>
            </td>
            <td>
              <span style="color: var(--adm-muted); font-size: 12px">
                {{ PRODUCT_TYPE_LABELS[product.productType] }} ›
              </span>
              <span style="font-weight: 500">{{ product.category.name }}</span>
            </td>
            <td class="admin-table-num" style="font-weight: 600">
              {{ product.variantCount }}
            </td>
            <td>
              <ProductStatusBadge :status="product.status" />
            </td>
            <td style="text-align: right">
              <NuxtLink :to="`/admin/products/${product.id}`" class="btn btn-secondary btn-sm"> Chi tiết › </NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
