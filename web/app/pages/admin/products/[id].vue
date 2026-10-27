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
const STATUS_BADGES = { draft: 'badge-draft', published: 'badge-published', archived: 'badge-archived' } as const
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
    'Đã lưu thông tin sản phẩm',
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
    variant.id ? `Đã lưu biến thể ${variant.sku}` : 'Đã thêm biến thể mới',
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
const schema = AttributeSchema.parse(await session.adminFetch(`/api/attribute-schemas/${product.value!.productType}`))
definitions.value = schema.attributes
if (canEdit) {
  brands.value = AdminBrandList.parse(await session.adminFetch('/api/admin/brands')).items
  categories.value = AdminCategoryList.parse(await session.adminFetch('/api/admin/categories')).items
}
policyPages.value = PolicyPageOptionList.parse(await session.adminFetch('/api/admin/products/policy-pages')).items
</script>

<template>
  <div v-if="product">
    <!-- Header & Navigation -->
    <div class="admin-page-header">
      <div>
        <div style="margin-bottom: 6px">
          <NuxtLink to="/admin/products" class="btn btn-ghost btn-sm" style="padding-left: 0">
            ← Quay lại danh sách sản phẩm
          </NuxtLink>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
          <h1 class="admin-page-title" style="margin: 0">{{ product.name }}</h1>
          <span class="badge" :class="STATUS_BADGES[product.status]">
            <span class="badge-dot" />
            {{ STATUS_LABELS[product.status] }}
          </span>
          <span class="badge badge-role">
            {{ PRODUCT_TYPE_LABELS[product.productType] }}
          </span>
        </div>
        <div style="margin-top: 4px; font-size: 13px; color: var(--adm-muted); font-family: var(--adm-mono)">
          /san-pham/{{ product.slug }}
        </div>
      </div>
    </div>

    <!-- Thông báo Alert -->
    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div v-if="notice" class="admin-alert admin-alert-success" role="status">
      <span>✓ {{ notice }}</span>
    </div>

    <!-- Bố cục 2 Cột Studio Workspace -->
    <div class="admin-two-col">
      <!-- CỘT TRÁI: Nội dung, Thuộc tính, Bảng Size, Biến thể (65%) -->
      <div>
        <!-- 1. Thông tin chung -->
        <div class="admin-panel">
          <div class="admin-panel-header">
            <div>
              <h2 class="admin-section-title" style="margin: 0">Thông tin cơ bản</h2>
              <p class="form-help" style="margin-top: 2px">Nhận diện sản phẩm, thương hiệu và nội dung biên tập.</p>
            </div>
            <button v-if="canEdit" type="button" class="btn btn-primary btn-sm" @click="saveProduct">
              Lưu thông tin
            </button>
          </div>

          <form @submit.prevent="saveProduct">
            <fieldset :disabled="!canEdit" style="border: none; padding: 0; margin: 0">
              <div class="form-grid-2">
                <div v-if="canEdit" class="form-group">
                  <label class="form-label">Thương hiệu *</label>
                  <select v-model="draft.brandId" class="form-select" required>
                    <option v-for="b in brands" :key="b.id" :value="b.id">{{ b.name }}</option>
                  </select>
                </div>

                <div v-if="canEdit" class="form-group">
                  <label class="form-label">Danh mục (Cùng nhóm hàng) *</label>
                  <select v-model="draft.categoryId" class="form-select" required>
                    <option v-for="c in sameTypeCategories" :key="c.id" :value="c.id">
                      {{ c.name }}
                    </option>
                  </select>
                </div>
              </div>

              <div class="form-grid-2">
                <div class="form-group">
                  <label class="form-label">Tên sản phẩm *</label>
                  <input v-model="draft.name" class="form-input" required />
                </div>

                <div class="form-group">
                  <label class="form-label">Slug URL *</label>
                  <input v-model="draft.slug" class="form-input" required pattern="[a-z0-9]+(-[a-z0-9]+)*" />
                  <small v-if="errorAt('product', 'slug')" class="field-error-msg">
                    {{ errorAt('product', 'slug') }}
                  </small>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label">Mã mẫu chính hãng (Model Code)</label>
                <input v-model="draft.modelCode" class="form-input" placeholder="Ví dụ: SRPD55K1, 386750..." />
                <p class="form-help">Khách hàng có thể tìm kiếm sản phẩm theo mã mẫu này.</p>
              </div>

              <div class="form-group">
                <label class="form-label">Mô tả sản phẩm</label>
                <textarea
                  v-model="draft.description"
                  class="form-textarea"
                  rows="4"
                  placeholder="Mô tả chất liệu, thiết kế, xuất xứ..."
                />
              </div>

              <div class="form-group">
                <label class="form-label">Hướng dẫn sử dụng và bảo quản</label>
                <textarea
                  v-model="draft.usageCare"
                  class="form-textarea"
                  rows="3"
                  placeholder="Cách lau chùi, giặt, bảo quản nơi khô thoáng..."
                />
              </div>

              <div class="form-group">
                <label class="form-label">Thông tin nguồn gốc tự công bố</label>
                <textarea
                  v-model="draft.originStatement"
                  class="form-textarea"
                  rows="2"
                  placeholder="Ví dụ: Hàng nhập khẩu chính ngạch từ nhà phân phối châu Âu."
                />
                <p class="form-help">
                  Lời doanh nghiệp tự công bố (không kèm chứng từ). Bảo hành chỉ hiện qua Cam kết có bằng chứng.
                </p>
              </div>

              <div class="form-group" style="margin-bottom: 0">
                <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer">
                  <input v-model="draft.groundShippingOnly" type="checkbox" />
                  <span>Chỉ giao đường bộ (áp dụng cho hàng cấm bay như nước hoa dung tích lớn)</span>
                </label>
              </div>
            </fieldset>
          </form>
        </div>

        <!-- 2. Thuộc tính nhóm hàng -->
        <div v-if="productDefinitions.length > 0" class="admin-panel">
          <div class="admin-panel-header">
            <div>
              <h2 class="admin-section-title" style="margin: 0">
                Thuộc tính cấp sản phẩm ({{ PRODUCT_TYPE_LABELS[product.productType] }})
              </h2>
              <p class="form-help" style="margin-top: 2px">
                Định nghĩa theo Schema nhóm hàng, dùng cho bộ lọc và thông số kỹ thuật.
              </p>
            </div>
            <button v-if="canEdit" type="button" class="btn btn-primary btn-sm" @click="saveProduct">
              Lưu thuộc tính
            </button>
          </div>

          <fieldset :disabled="!canEdit" style="border: none; padding: 0; margin: 0">
            <div class="form-grid-2">
              <div v-for="definition in productDefinitions" :key="definition.key" class="form-group">
                <label class="form-label">{{ definition.label }}</label>
                <AttributeInput v-model="draft.attributes[definition.key]" :definition="definition" />
                <small v-if="errorAt('product', `attributes.${definition.key}`)" class="field-error-msg">
                  {{ errorAt('product', `attributes.${definition.key}`) }}
                </small>
              </div>
            </div>
          </fieldset>
        </div>

        <!-- 3. Bảng Size Chart -->
        <div class="admin-panel">
          <div class="admin-panel-header">
            <div>
              <h2 class="admin-section-title" style="margin: 0">Bảng kích thước (Size Chart)</h2>
              <p class="form-help" style="margin-top: 2px">Hướng dẫn quy đổi và đo size cho khách hàng.</p>
            </div>
            <div v-if="canEdit">
              <button v-if="!draft.sizeChart" type="button" class="btn btn-secondary btn-sm" @click="addSizeChart">
                + Thêm bảng size
              </button>
              <button v-else type="button" class="btn btn-primary btn-sm" @click="saveProduct">Lưu bảng size</button>
            </div>
          </div>

          <div
            v-if="!draft.sizeChart"
            style="
              padding: 20px;
              text-align: center;
              color: var(--adm-muted);
              background: var(--adm-surface-subtle);
              border-radius: 6px;
            "
          >
            Sản phẩm chưa thiết lập bảng size.
          </div>

          <div v-else>
            <div style="overflow-x: auto; margin-bottom: 12px">
              <table class="admin-table" style="background: var(--adm-surface)">
                <thead>
                  <tr>
                    <th v-for="(_, col) in draft.sizeChart.columns" :key="col" style="padding: 6px 10px">
                      <div style="display: flex; gap: 4px; align-items: center">
                        <input
                          v-model="draft.sizeChart.columns[col]"
                          class="form-input"
                          style="padding: 4px 6px; font-size: 12px; font-weight: 600"
                          placeholder="Tiêu đề"
                          required
                          :disabled="!canEdit"
                        />
                        <button
                          v-if="canEdit"
                          type="button"
                          class="btn btn-ghost btn-sm"
                          style="padding: 2px 6px; color: var(--adm-danger)"
                          :disabled="draft.sizeChart.columns.length === 1"
                          @click="removeColumn(draft.sizeChart, col)"
                        >
                          ✕
                        </button>
                      </div>
                    </th>
                    <th style="width: 50px" />
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rowIndex) in draft.sizeChart.rows" :key="rowIndex">
                    <td v-for="(_, col) in row" :key="col" style="padding: 6px 10px">
                      <input
                        v-model="row[col]"
                        class="form-input"
                        style="padding: 4px 6px; font-size: 12px"
                        placeholder="Giá trị"
                        :disabled="!canEdit"
                      />
                    </td>
                    <td style="text-align: center; padding: 6px">
                      <button
                        v-if="canEdit"
                        type="button"
                        class="btn btn-ghost btn-sm"
                        style="color: var(--adm-danger); padding: 2px 6px"
                        @click="draft.sizeChart.rows.splice(rowIndex, 1)"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div v-if="canEdit" style="display: flex; gap: 8px">
              <button type="button" class="btn btn-secondary btn-sm" @click="addColumn(draft.sizeChart)">
                + Thêm cột
              </button>
              <button type="button" class="btn btn-secondary btn-sm" @click="addRow(draft.sizeChart)">
                + Thêm hàng
              </button>
              <button type="button" class="btn btn-danger btn-sm" @click="draft.sizeChart = null">
                Xóa toàn bộ bảng
              </button>
            </div>
          </div>
        </div>

        <!-- 4. Ma trận biến thể -->
        <div class="admin-panel">
          <div class="admin-panel-header">
            <div>
              <h2 class="admin-section-title" style="margin: 0">Ma trận Biến thể (Variants & SKUs)</h2>
              <p class="form-help" style="margin-top: 2px">
                Quản lý SKU duy nhất, thuộc tính riêng biệt (Màu, Size, Dung tích), giá bán và giá hãng.
                <span v-if="!canPrice" style="color: var(--adm-draft)"> (Bạn không có quyền sửa giá).</span>
              </p>
            </div>
          </div>

          <div style="overflow-x: auto">
            <table class="admin-table">
              <thead>
                <tr>
                  <th style="min-width: 130px">SKU *</th>
                  <th v-for="d in variantDefinitions" :key="d.key">{{ d.label }}</th>
                  <th style="min-width: 110px">Trạng thái</th>
                  <th style="min-width: 120px" class="admin-table-num">Giá bán (₫)</th>
                  <th style="min-width: 120px" class="admin-table-num">Giá hãng (₫)</th>
                  <th style="text-align: right; min-width: 90px">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="v in [...variants, newVariant]"
                  :key="v.id || 'new'"
                  :style="{ background: !v.id ? 'var(--adm-surface-subtle)' : undefined }"
                >
                  <!-- SKU -->
                  <td>
                    <input
                      v-model="v.sku"
                      class="form-input"
                      style="font-family: var(--adm-mono); font-size: 12px; font-weight: 600"
                      :placeholder="!v.id ? '+ SKU MỚI' : 'SKU'"
                      required
                      :disabled="!canEdit"
                    />
                    <small v-for="path in ['sku', 'attributes', 'status']" :key="path" class="field-error-msg">
                      {{ errorAt(v.id, path) }}
                    </small>
                  </td>

                  <!-- Variant Attributes -->
                  <td v-for="d in variantDefinitions" :key="d.key">
                    <AttributeInput v-model="v.attributes[d.key]" :definition="d" :disabled="!canEdit" />
                    <small v-if="errorAt(v.id, `attributes.${d.key}`)" class="field-error-msg">
                      {{ errorAt(v.id, `attributes.${d.key}`) }}
                    </small>
                  </td>

                  <!-- Trạng thái bán -->
                  <td>
                    <select v-model="v.status" class="form-select" style="font-size: 12px" :disabled="!canEdit">
                      <option v-for="s in VariantStatus.options" :key="s" :value="s">
                        {{ VARIANT_STATUS_LABELS[s] }}
                      </option>
                    </select>
                  </td>

                  <!-- Giá bán -->
                  <td>
                    <input
                      type="number"
                      min="1"
                      step="1000"
                      class="form-input admin-table-num"
                      style="font-weight: 600"
                      :value="v.price ?? ''"
                      placeholder="Chưa đặt"
                      :disabled="!canPrice"
                      @input="setPrice(v, 'price', ($event.target as HTMLInputElement).value)"
                    />
                    <small v-if="errorAt(v.id, 'price')" class="field-error-msg">
                      {{ errorAt(v.id, 'price') }}
                    </small>
                  </td>

                  <!-- Giá hãng -->
                  <td>
                    <input
                      type="number"
                      min="1"
                      step="1000"
                      class="form-input admin-table-num"
                      :value="v.compareAtPrice ?? ''"
                      placeholder="Không có"
                      :disabled="!canPrice"
                      @input="setPrice(v, 'compareAtPrice', ($event.target as HTMLInputElement).value)"
                    />
                    <small v-if="errorAt(v.id, 'compareAtPrice')" class="field-error-msg">
                      {{ errorAt(v.id, 'compareAtPrice') }}
                    </small>
                  </td>

                  <!-- Actions -->
                  <td style="text-align: right">
                    <button v-if="v.id" type="button" class="btn btn-secondary btn-sm" @click="saveVariant(v)">
                      Lưu
                    </button>
                    <button v-else-if="canEdit" type="button" class="btn btn-primary btn-sm" @click="saveVariant(v)">
                      + Thêm
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 5. Chính sách áp dụng -->
        <div class="admin-panel">
          <div class="admin-panel-header">
            <div>
              <h2 class="admin-section-title" style="margin: 0">Chính sách áp dụng</h2>
              <p class="form-help" style="margin-top: 2px">
                Gắn các điều khoản đổi trả, bảo hành liên quan vào sản phẩm.
              </p>
            </div>
            <button v-if="canEdit" type="button" class="btn btn-primary btn-sm" @click="savePolicies">
              Lưu chính sách
            </button>
          </div>

          <div v-if="!policyPages.length" style="color: var(--adm-muted); font-size: 13px">
            Chưa có trang bài viết loại chính sách nào được tạo.
          </div>

          <div v-else style="display: flex; flex-direction: column; gap: 8px">
            <label
              v-for="page in policyPages"
              :key="page.id"
              style="display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer"
            >
              <input v-model="policyPageIds" type="checkbox" :value="page.id" :disabled="!canEdit" />
              <span style="font-weight: 500">{{ page.title }}</span>
              <span v-if="!page.published" style="color: var(--adm-draft); font-size: 11px">
                (bản nháp chưa xuất bản, khách chưa thấy)
              </span>
            </label>
          </div>
        </div>
      </div>

      <!-- CỘT PHẢI: Trạm Xuất bản, Ảnh, Chứng từ, Cam kết (35%) -->
      <div>
        <!-- Trạm kiểm soát xuất bản (Publication Station) -->
        <div class="admin-panel" style="border-top: 3px solid var(--adm-dark)">
          <h2 class="admin-section-title" style="margin-bottom: 12px">Trạm kiểm soát xuất bản</h2>

          <div style="background: var(--adm-surface-subtle); padding: 14px; border-radius: 6px; margin-bottom: 16px">
            <div
              style="
                font-size: 11px;
                color: var(--adm-muted);
                margin-bottom: 4px;
                text-transform: uppercase;
                font-weight: 600;
              "
            >
              Trạng thái hiển thị công khai:
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between">
              <span class="badge" :class="STATUS_BADGES[product.status]" style="font-size: 12px">
                <span class="badge-dot" />
                {{ STATUS_LABELS[product.status] }}
              </span>

              <NuxtLink
                v-if="product.liveVersion"
                :to="`/san-pham/${product.slug}`"
                target="_blank"
                class="btn btn-ghost btn-sm"
                style="padding: 2px 6px; font-size: 12px"
              >
                Xem trang live ↗
              </NuxtLink>
            </div>

            <div v-if="product.liveVersion" style="margin-top: 10px; font-size: 12px; color: var(--adm-muted)">
              Khách đang thấy phiên bản: <strong>v.{{ product.liveVersion.version }}</strong>
            </div>

            <div
              v-if="product.hasUnpublishedChanges"
              style="
                margin-top: 8px;
                padding: 6px 10px;
                background: var(--adm-draft-bg);
                border: 1px solid var(--adm-draft-border);
                border-radius: 4px;
                font-size: 12px;
                color: var(--adm-draft);
                font-weight: 500;
              "
            >
              ⚠ Có thay đổi trong bản soạn chưa được xuất bản.
            </div>
          </div>

          <!-- Lỗi chặn xuất bản -->
          <div
            v-if="fieldErrors.target === 'status' && fieldErrors.fields.length"
            class="admin-alert admin-alert-danger"
            style="font-size: 12px; margin-bottom: 14px; flex-direction: column; gap: 4px"
          >
            <strong>Không đủ điều kiện xuất bản:</strong>
            <ul style="margin: 0; padding-left: 18px">
              <li v-for="f in fieldErrors.fields" :key="f.path">{{ f.message }}</li>
            </ul>
          </div>

          <!-- Các nút hành động vòng đời -->
          <div v-if="canEdit" style="display: flex; flex-direction: column; gap: 8px">
            <button
              v-if="product.status === 'draft'"
              type="button"
              class="btn btn-primary"
              style="width: 100%; justify-content: center"
              @click="changeStatus('published', 'Đã xuất bản sản phẩm')"
            >
              Xuất bản lên website
            </button>

            <button
              v-if="product.status === 'published'"
              type="button"
              class="btn btn-primary"
              style="width: 100%; justify-content: center"
              :disabled="!product.hasUnpublishedChanges"
              @click="changeStatus('published', 'Đã xuất bản thay đổi mới')"
            >
              Xuất bản thay đổi mới
            </button>

            <button
              v-if="product.status !== 'archived'"
              type="button"
              class="btn btn-secondary"
              style="width: 100%; justify-content: center; color: var(--adm-archived)"
              @click="changeStatus('archived', 'Đã chuyển vào lưu trữ')"
            >
              Lưu trữ sản phẩm
            </button>

            <button
              v-if="product.status === 'archived'"
              type="button"
              class="btn btn-secondary"
              style="width: 100%; justify-content: center"
              @click="changeStatus('draft', 'Đã đưa về bản nháp')"
            >
              Đưa về bản nháp để sửa
            </button>
          </div>
        </div>

        <!-- Thư viện hình ảnh -->
        <ProductImages :product-id="id" :variants="imageVariants" />

        <!-- Chứng từ nguồn hàng -->
        <ProductDocuments v-if="canViewDocuments" :product-id="id" @change="documents = $event" />

        <!-- Cam kết có bằng chứng -->
        <ProductCommitments :product-id="id" :documents="documents" />
      </div>
    </div>
  </div>
</template>
