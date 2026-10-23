<script setup lang="ts">
import {
  AdminBrandList,
  AdminCategoryList,
  AdminProductDetail,
  AdminVariant,
  PolicyPageOptionList,
  AttributeSchema,
  VariantStatus,
  type AdminBrand,
  type AdminProductDocument,
  type AdminCategory,
  type AttributeDefinition,
  type AttributeValue,
  type FieldError,
  type SizeChart,
} from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: ['catalog.edit', 'price.edit'] })

type Values = Record<string, AttributeValue | null | undefined>
/** Một dòng biến thể đang soạn; `id` rỗng là dòng thêm mới. */
type VariantDraft = {
  id: string
  sku: string
  attributes: Values
  status: VariantStatus
  sortOrder: number
  price: number | null
  compareAtPrice: number | null
}

const STATUS_LABELS = { draft: 'Nháp', published: 'Đã xuất bản', archived: 'Lưu trữ' } as const
const VARIANT_STATUS_LABELS: Record<VariantStatus, string> = { active: 'Đang bán', discontinued: 'Ngừng bán' }

const route = useRoute()
const id = String(route.params.id)
const session = useAdminSession()
// Quyền thật do API kiểm; ở đây chỉ để khóa những ô người dùng không sửa được.
const canEdit = session.can('catalog.edit')
const canPrice = session.can('price.edit')
const canViewDocuments = session.can('document.view')
/** Chứng từ đã tải, để chọn làm bằng chứng cho cam kết. */
const documents = ref<AdminProductDocument[]>([])

const product = ref<AdminProductDetail | null>(null)
const brands = ref<AdminBrand[]>([])
const categories = ref<AdminCategory[]>([])
const definitions = ref<AttributeDefinition[]>([])
const draft = ref({
  brandId: '',
  categoryId: '',
  name: '',
  slug: '',
  modelCode: '',
  description: '',
  usageCare: '',
  sizeChart: null as SizeChart | null,
  originStatement: '',
  attributes: {} as Values,
  groundShippingOnly: false,
})
const variants = ref<VariantDraft[]>([])
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
/** Lỗi theo trường của lần lưu gần nhất; khóa là `product` hoặc id biến thể (rỗng với dòng thêm mới). */
const fieldErrors = ref<{ target: string; fields: FieldError[] }>({ target: '', fields: [] })

const productDefinitions = computed(() => definitions.value.filter((d) => d.level === 'product'))
const variantDefinitions = computed(() => definitions.value.filter((d) => d.level === 'variant'))
/** Biến thể đã lưu, để gắn ảnh: nhãn là SKU kèm tổ hợp thuộc tính. */
const imageVariants = computed(() =>
  (product.value?.variants ?? []).map((v) => ({
    id: v.id,
    label: [v.sku, ...Object.values(v.attributes).map(String)].join(' · '),
  })),
)
const sameTypeCategories = computed(() => categories.value.filter((c) => c.productType === product.value?.productType))

const emptyVariant = (): VariantDraft => ({
  id: '',
  sku: '',
  attributes: {},
  status: 'active',
  sortOrder: variants.value.length,
  price: null,
  compareAtPrice: null,
})
const newVariant = ref<VariantDraft>(emptyVariant())

function show(detail: AdminProductDetail) {
  product.value = detail
  const { brandId, categoryId, name, slug, modelCode, description, usageCare, originStatement } = detail
  draft.value = {
    brandId,
    categoryId,
    name,
    slug,
    modelCode,
    description,
    usageCare,
    originStatement,
    sizeChart: structuredClone(detail.sizeChart),
    attributes: { ...detail.attributes },
    groundShippingOnly: detail.groundShippingOnly,
  }
  variants.value = detail.variants.map((v) => ({ ...v, attributes: { ...v.attributes } }))
  newVariant.value = emptyVariant()
  policyPageIds.value = [...detail.policyPageIds]
}

// Vòng đời và chính sách

const policyPages = ref<PolicyPageOptionList['items']>([])
const policyPageIds = ref<string[]>([])

function changeStatus(status: 'published' | 'archived' | 'draft', message: string) {
  return run(
    'status',
    () => session.adminFetch(`/api/admin/products/${id}/status`, { method: 'PUT', body: { status } }),
    message,
  )
}

function savePolicies() {
  return run(
    'policies',
    () =>
      session.adminFetch(`/api/admin/products/${id}/policies`, {
        method: 'PUT',
        body: { pageIds: policyPageIds.value },
      }),
    'Đã lưu chính sách áp dụng',
  )
}

async function load() {
  show(AdminProductDetail.parse(await session.adminFetch(`/api/admin/products/${id}`)))
}

const errorAt = (target: string, path: string) =>
  fieldErrors.value.target === target ? fieldErrors.value.fields.find((f) => f.path === path)?.message : undefined

/** Chạy một thao tác lưu; lỗi theo trường gắn vào `target` để hiện cạnh đúng ô. */
async function run(target: string, action: () => Promise<unknown>, message: string) {
  error.value = null
  notice.value = null
  fieldErrors.value = { target, fields: [] }
  try {
    await action()
    await load()
    notice.value = message
  } catch (err) {
    error.value = apiErrorMessage(err)
    fieldErrors.value = { target, fields: apiFieldErrors(err) }
  }
}

function saveProduct() {
  return run(
    'product',
    () => session.adminFetch(`/api/admin/products/${id}`, { method: 'PUT', body: draft.value }),
    'Đã lưu sản phẩm',
  )
}

function variantBody({ sku, attributes, status, sortOrder, price, compareAtPrice }: VariantDraft) {
  // Chỉ gửi giá khi có `price.edit`; bỏ qua thì API giữ nguyên giá.
  return { sku, attributes, status, sortOrder, ...(canPrice && { price, compareAtPrice }) }
}

function saveVariant(variant: VariantDraft) {
  return run(
    variant.id,
    async () =>
      AdminVariant.parse(
        await session.adminFetch(
          variant.id ? `/api/admin/products/${id}/variants/${variant.id}` : `/api/admin/products/${id}/variants`,
          { method: variant.id ? 'PUT' : 'POST', body: variantBody(variant) },
        ),
      ),
    variant.id ? `Đã lưu biến thể ${variant.sku}` : 'Đã thêm biến thể',
  )
}

/** Ô giá: chuỗi rỗng là chưa đặt giá. */
function setPrice(variant: VariantDraft, field: 'price' | 'compareAtPrice', raw: string) {
  variant[field] = raw.trim() === '' ? null : Number(raw)
}

// Bảng size

function addSizeChart() {
  draft.value.sizeChart = { columns: ['Size'], rows: [] }
}

function addColumn(chart: SizeChart) {
  chart.columns.push('')
  chart.rows.forEach((row) => row.push(''))
}

function removeColumn(chart: SizeChart, index: number) {
  chart.columns.splice(index, 1)
  chart.rows.forEach((row) => row.splice(index, 1))
}

function addRow(chart: SizeChart) {
  chart.rows.push(chart.columns.map(() => ''))
}

await load()
const schema = AttributeSchema.parse(await $fetch(`/api/attribute-schemas/${product.value!.productType}`))
definitions.value = schema.attributes
// Thương hiệu và danh mục cần `catalog.edit`; người chỉ sửa giá xem phần chung ở dạng chỉ đọc.
if (canEdit) {
  brands.value = AdminBrandList.parse(await session.adminFetch('/api/admin/brands')).items
  categories.value = AdminCategoryList.parse(await session.adminFetch('/api/admin/categories')).items
}
policyPages.value = PolicyPageOptionList.parse(await session.adminFetch('/api/admin/products/policy-pages')).items
</script>

<template>
  <main v-if="product">
    <p><NuxtLink to="/admin/products">← Sản phẩm</NuxtLink></p>
    <h1>{{ product.name }}</h1>
    <p>{{ PRODUCT_TYPE_LABELS[product.productType] }} · {{ STATUS_LABELS[product.status] }}</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>

    <section aria-labelledby="lifecycle">
      <h2 id="lifecycle">Xuất bản</h2>
      <p v-if="product.liveVersion">
        Khách đang thấy phiên bản {{ product.liveVersion.version }} (<NuxtLink
          :to="`/san-pham/${product.slug}`"
          target="_blank"
          >xem trang</NuxtLink
        >).
        <strong v-if="product.hasUnpublishedChanges">Có thay đổi chưa xuất bản.</strong>
      </p>
      <p v-else>Sản phẩm chưa hiện với khách.</p>
      <p v-if="product.status === 'published'">
        <small>Sửa thông tin, biến thể, giá, ảnh hay chính sách chỉ hiện với khách sau khi xuất bản lại.</small>
      </p>
      <ul v-if="fieldErrors.target === 'status' && fieldErrors.fields.length" role="alert">
        <li v-for="field in fieldErrors.fields" :key="field.path">{{ field.message }}</li>
      </ul>
      <template v-if="canEdit">
        <button v-if="product.status === 'draft'" type="button" @click="changeStatus('published', 'Đã xuất bản')">
          Xuất bản
        </button>
        <button
          v-if="product.status === 'published'"
          type="button"
          :disabled="!product.hasUnpublishedChanges"
          @click="changeStatus('published', 'Đã xuất bản thay đổi')"
        >
          Xuất bản thay đổi
        </button>
        <button v-if="product.status !== 'archived'" type="button" @click="changeStatus('archived', 'Đã lưu trữ')">
          Lưu trữ
        </button>
        <button v-if="product.status === 'archived'" type="button" @click="changeStatus('draft', 'Đã đưa về nháp')">
          Đưa về nháp
        </button>
      </template>
    </section>

    <form @submit.prevent="saveProduct">
      <fieldset :disabled="!canEdit">
        <legend>Thông tin chung</legend>
        <label v-if="canEdit">
          Thương hiệu
          <select v-model="draft.brandId" required>
            <option v-for="brand in brands" :key="brand.id" :value="brand.id">{{ brand.name }}</option>
          </select>
        </label>
        <label v-if="canEdit">
          Danh mục
          <select v-model="draft.categoryId" required>
            <option v-for="category in sameTypeCategories" :key="category.id" :value="category.id">
              {{ category.name }}
            </option>
          </select>
        </label>
        <label>Tên <input v-model="draft.name" required /></label>
        <label>
          Slug <input v-model="draft.slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
          <small v-if="errorAt('product', 'slug')" role="alert">{{ errorAt('product', 'slug') }}</small>
        </label>
        <label>Mã mẫu <input v-model="draft.modelCode" placeholder="SRPD55K1" /></label>
        <label>Mô tả <textarea v-model="draft.description" rows="5" /></label>
        <label>Hướng dẫn sử dụng và bảo quản <textarea v-model="draft.usageCare" rows="3" /></label>
        <label>
          Thông tin nguồn gốc công bố
          <textarea v-model="draft.originStatement" rows="3" />
          <small>Lời doanh nghiệp tự công bố, không kèm bằng chứng. Bảo hành chỉ hiện qua cam kết có chứng từ.</small>
        </label>
        <label><input v-model="draft.groundShippingOnly" type="checkbox" /> Chỉ giao đường bộ</label>
      </fieldset>

      <fieldset :disabled="!canEdit">
        <legend>Thuộc tính</legend>
        <div v-for="definition in productDefinitions" :key="definition.key">
          <label>
            {{ definition.label }}
            <AttributeInput v-model="draft.attributes[definition.key]" :definition="definition" />
          </label>
          <small v-if="errorAt('product', `attributes.${definition.key}`)" role="alert">
            {{ errorAt('product', `attributes.${definition.key}`) }}
          </small>
        </div>
      </fieldset>

      <fieldset :disabled="!canEdit">
        <legend>Bảng size</legend>
        <button v-if="!draft.sizeChart" type="button" @click="addSizeChart">Thêm bảng size</button>
        <template v-else>
          <table>
            <thead>
              <tr>
                <th v-for="(_, col) in draft.sizeChart.columns" :key="col">
                  <input v-model="draft.sizeChart.columns[col]" aria-label="Tiêu đề cột" required />
                  <button
                    type="button"
                    :disabled="draft.sizeChart.columns.length === 1"
                    @click="removeColumn(draft.sizeChart, col)"
                  >
                    Xóa cột
                  </button>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in draft.sizeChart.rows" :key="rowIndex">
                <td v-for="(_, col) in row" :key="col"><input v-model="row[col]" aria-label="Ô bảng size" /></td>
                <td><button type="button" @click="draft.sizeChart.rows.splice(rowIndex, 1)">Xóa hàng</button></td>
              </tr>
            </tbody>
          </table>
          <button type="button" @click="addColumn(draft.sizeChart)">Thêm cột</button>
          <button type="button" @click="addRow(draft.sizeChart)">Thêm hàng</button>
          <button type="button" @click="draft.sizeChart = null">Bỏ bảng size</button>
        </template>
      </fieldset>

      <button v-if="canEdit" type="submit">Lưu sản phẩm</button>
    </form>

    <h2>Biến thể</h2>
    <p>
      Mỗi biến thể có SKU riêng và một tổ hợp thuộc tính không trùng trong sản phẩm. Giá tính bằng VND, đã gồm VAT; giá
      hãng là giá bán lẻ chính thức của thương hiệu, để trống hoặc không thấp hơn giá bán.
      <template v-if="!canPrice">Bạn không có quyền sửa giá.</template>
    </p>
    <table>
      <thead>
        <tr>
          <th>SKU</th>
          <th v-for="definition in variantDefinitions" :key="definition.key">{{ definition.label }}</th>
          <th>Trạng thái</th>
          <th>Thứ tự</th>
          <th>Giá bán (₫)</th>
          <th>Giá hãng (₫)</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="variant in [...variants, newVariant]" :key="variant.id || 'new'">
          <td>
            <input v-model="variant.sku" aria-label="SKU" required :disabled="!canEdit" />
            <small v-for="path in ['sku', 'attributes', 'status']" :key="path" role="alert">
              {{ errorAt(variant.id, path) }}
            </small>
          </td>
          <td v-for="definition in variantDefinitions" :key="definition.key">
            <AttributeInput
              v-model="variant.attributes[definition.key]"
              :definition="definition"
              :disabled="!canEdit"
            />
            <small role="alert">{{ errorAt(variant.id, `attributes.${definition.key}`) }}</small>
          </td>
          <td>
            <select v-model="variant.status" aria-label="Trạng thái" :disabled="!canEdit">
              <option v-for="status in VariantStatus.options" :key="status" :value="status">
                {{ VARIANT_STATUS_LABELS[status] }}
              </option>
            </select>
          </td>
          <td>
            <input v-model.number="variant.sortOrder" type="number" min="0" aria-label="Thứ tự" :disabled="!canEdit" />
          </td>
          <td v-for="field in ['price', 'compareAtPrice'] as const" :key="field">
            <input
              type="number"
              min="1"
              step="1"
              :value="variant[field] ?? ''"
              :aria-label="field === 'price' ? 'Giá bán' : 'Giá hãng'"
              :disabled="!canPrice"
              @input="setPrice(variant, field, ($event.target as HTMLInputElement).value)"
            />
            <small role="alert">{{ errorAt(variant.id, field) }}</small>
          </td>
          <td>
            <button v-if="variant.id" type="button" @click="saveVariant(variant)">Lưu</button>
            <button v-else-if="canEdit" type="button" @click="saveVariant(variant)">Thêm biến thể</button>
          </td>
        </tr>
      </tbody>
    </table>

    <ProductImages :product-id="id" :variants="imageVariants" />

    <form @submit.prevent="savePolicies">
      <fieldset :disabled="!canEdit">
        <legend>Chính sách áp dụng</legend>
        <p v-if="!policyPages.length">Chưa có trang nội dung loại chính sách nào.</p>
        <label v-for="page in policyPages" :key="page.id">
          <input v-model="policyPageIds" type="checkbox" :value="page.id" />
          {{ page.title }}
          <small v-if="!page.published">(chưa xuất bản, khách chưa thấy)</small>
        </label>
      </fieldset>
      <button v-if="canEdit" type="submit">Lưu chính sách</button>
    </form>
    <ProductDocuments v-if="canViewDocuments" :product-id="id" @change="documents = $event" />
    <ProductCommitments :product-id="id" :documents="documents" />
  </main>
</template>
