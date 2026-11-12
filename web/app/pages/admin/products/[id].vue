<script setup lang="ts">
import {
  AdminBrandList,
  AdminCategoryList,
  AdminProductDetail,
  AdminVariant,
  PolicyPageOptionList,
  AttributeSchema,
  type AdminBrand,
  type AdminProductDocument,
  type AdminCategory,
  type AttributeDefinition,
  type SizeChart,
} from '@ecommerce/shared'
import type { DraftValues, TargetedFieldErrors, VariantDraft } from '~/utils/productDraft'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: ['catalog.edit', 'price.edit'] })

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
  attributes: {} as DraftValues,
  groundShippingOnly: false,
})
const variants = ref<VariantDraft[]>([])
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const fieldErrors = ref<TargetedFieldErrors>({ target: '', fields: [] })

const productDefinitions = computed(() => definitions.value.filter((d) => d.level === 'product'))
const variantDefinitions = computed(() => definitions.value.filter((d) => d.level === 'variant'))
/** Biến thể đã lưu, để gắn ảnh: nhãn là SKU kèm tổ hợp thuộc tính. */
const imageVariants = computed(() =>
  (product.value?.variants ?? []).map((v) => ({
    id: v.id,
    label: [v.sku, ...Object.values(v.attributes).map(String)].join(' · '),
  })),
)
const onHand = computed(() => new Map((product.value?.variants ?? []).map((v) => [v.id, v.onHand])))
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

const errorAt = (path: string) => fieldErrorAt(fieldErrors.value, 'product', path)

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
    <div class="admin-page-header">
      <div>
        <div style="margin-bottom: 6px">
          <NuxtLink to="/admin/products" class="btn btn-ghost btn-sm" style="padding-left: 0">
            ← Quay lại danh sách sản phẩm
          </NuxtLink>
        </div>
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
          <h1 class="admin-page-title" style="margin: 0">{{ product.name }}</h1>
          <ProductStatusBadge :status="product.status" />
          <span class="badge badge-role">
            {{ PRODUCT_TYPE_LABELS[product.productType] }}
          </span>
        </div>
        <div style="margin-top: 4px; font-size: 13px; color: var(--adm-muted); font-family: var(--adm-mono)">
          /san-pham/{{ product.slug }}
        </div>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div v-if="notice" class="admin-alert admin-alert-success" role="status">
      <span>✓ {{ notice }}</span>
    </div>

    <div class="admin-two-col">
      <div>
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
                  <label class="form-label" for="product-brand">Thương hiệu *</label>
                  <select id="product-brand" v-model="draft.brandId" class="form-select" required>
                    <option v-for="b in brands" :key="b.id" :value="b.id">{{ b.name }}</option>
                  </select>
                </div>

                <div v-if="canEdit" class="form-group">
                  <label class="form-label" for="product-category">Danh mục (Cùng nhóm hàng) *</label>
                  <select id="product-category" v-model="draft.categoryId" class="form-select" required>
                    <option v-for="c in sameTypeCategories" :key="c.id" :value="c.id">
                      {{ c.name }}
                    </option>
                  </select>
                </div>
              </div>

              <div class="form-grid-2">
                <div class="form-group">
                  <label class="form-label" for="product-name">Tên sản phẩm *</label>
                  <input id="product-name" v-model="draft.name" class="form-input" required />
                </div>

                <div class="form-group">
                  <label class="form-label" for="product-slug">Slug URL *</label>
                  <input
                    id="product-slug"
                    v-model="draft.slug"
                    class="form-input"
                    required
                    pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  />
                  <small v-if="errorAt('slug')" class="field-error-msg">
                    {{ errorAt('slug') }}
                  </small>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="product-model-code">Mã mẫu (Model Code)</label>
                <input
                  id="product-model-code"
                  v-model="draft.modelCode"
                  class="form-input"
                  placeholder="Ví dụ: SRPD55K1, 386750..."
                />
                <p class="form-help">Khách hàng có thể tìm kiếm sản phẩm theo mã mẫu này.</p>
              </div>

              <div class="form-group">
                <label class="form-label" for="product-description">Mô tả sản phẩm</label>
                <textarea
                  id="product-description"
                  v-model="draft.description"
                  class="form-textarea"
                  rows="4"
                  placeholder="Mô tả chất liệu, thiết kế, xuất xứ..."
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="product-usage-care">Hướng dẫn sử dụng và bảo quản</label>
                <textarea
                  id="product-usage-care"
                  v-model="draft.usageCare"
                  class="form-textarea"
                  rows="3"
                  placeholder="Cách lau chùi, giặt, bảo quản nơi khô thoáng..."
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="product-origin">Thông tin nguồn gốc công bố</label>
                <textarea
                  id="product-origin"
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
                <label class="form-label" :for="`product-attr-${definition.key}`">{{ definition.label }}</label>
                <AttributeInput
                  :id="`product-attr-${definition.key}`"
                  v-model="draft.attributes[definition.key]"
                  :definition="definition"
                />
                <small v-if="errorAt(`attributes.${definition.key}`)" class="field-error-msg">
                  {{ errorAt(`attributes.${definition.key}`) }}
                </small>
              </div>
            </div>
          </fieldset>
        </div>

        <SizeChartEditor v-model="draft.sizeChart" :disabled="!canEdit" @save="saveProduct" />

        <VariantMatrix
          v-model:variants="variants"
          v-model:new-variant="newVariant"
          :definitions="variantDefinitions"
          :on-hand="onHand"
          :errors="fieldErrors"
          :can-edit="canEdit"
          :can-price="canPrice"
          @save="saveVariant"
        />

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

      <div>
        <PublicationPanel
          :product="product"
          :blockers="fieldErrors.target === 'status' ? fieldErrors.fields : []"
          :can-edit="canEdit"
          @change-status="changeStatus"
        />

        <ProductImages :product-id="id" :variants="imageVariants" />

        <ProductDocuments v-if="canViewDocuments" v-model="documents" :product-id="id" />
        <ProductCommitments :product-id="id" :documents="documents" />
      </div>
    </div>
  </div>
</template>
