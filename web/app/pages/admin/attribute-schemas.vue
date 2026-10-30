<script setup lang="ts">
import {
  AdminAttributeSchema,
  AdminAttributeSchemaList,
  ApiErrorBody,
  AttributeLevel,
  GENDER_KEY,
  ProductType,
  type AttributeDefinition,
  type AttributeType,
  type FieldError,
} from '@ecommerce/shared'

definePageMeta({ layout: 'admin', middleware: 'admin-auth', permission: 'catalog.edit' })

const TYPE_LABELS: Record<AttributeType, string> = {
  enum: 'Chọn một',
  multi_enum: 'Chọn nhiều',
  text: 'Chữ',
  number: 'Số',
  boolean: 'Có / không',
}
const LEVEL_LABELS: Record<AttributeLevel, string> = { product: 'Sản phẩm', variant: 'Biến thể' }

/** Một dòng đang soạn; giá trị cho phép gõ mỗi dòng một giá trị. */
type Draft = {
  key: string
  label: string
  type: AttributeType
  level: AttributeLevel
  required: boolean
  filterable: boolean
  options: string
  unit: string
}

const session = useAdminSession()
const schemas = ref<AdminAttributeSchema[]>([])
const selected = ref<ProductType>('footwear')
const drafts = ref<Draft[]>([])
const error = ref<string | null>(null)
const fieldErrors = ref<FieldError[]>([])
const saved = ref(false)

function toDraft(definition: AttributeDefinition): Draft {
  return {
    ...definition,
    options: 'options' in definition ? definition.options.join('\n') : '',
    unit: definition.type === 'number' ? (definition.unit ?? '') : '',
  }
}

function toDefinition({ options, unit, ...draft }: Draft): AttributeDefinition {
  const base = { ...draft, key: draft.key.trim(), label: draft.label.trim() }
  const values = options
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean)
  switch (base.type) {
    case 'enum':
      return { ...base, type: 'enum', options: values }
    case 'multi_enum':
      return { ...base, type: 'multi_enum', options: values }
    case 'number':
      return { ...base, type: 'number', unit: unit.trim() || null }
    case 'text':
      return { ...base, type: 'text' }
    case 'boolean':
      return { ...base, type: 'boolean' }
  }
}

function emptyDraft(): Draft {
  return {
    key: '',
    label: '',
    type: 'text',
    level: 'product',
    required: false,
    filterable: false,
    options: '',
    unit: '',
  }
}

async function load() {
  schemas.value = AdminAttributeSchemaList.parse(await session.adminFetch('/api/admin/attribute-schemas')).items
  reset()
}

function reset() {
  const current = schemas.value.find((s) => s.productType === selected.value)
  drafts.value = (current?.attributes ?? []).map(toDraft)
  fieldErrors.value = []
  error.value = null
}

function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= drafts.value.length) return
  const item = drafts.value.splice(index, 1)[0]!
  drafts.value.splice(target, 0, item)
}

function add() {
  drafts.value.push(emptyDraft())
}

async function save() {
  error.value = null
  fieldErrors.value = []
  saved.value = false
  const body = { attributes: drafts.value.map(toDefinition) }
  try {
    const updated = await session.adminFetch(`/api/admin/attribute-schemas/${selected.value}`, {
      method: 'PUT',
      body,
    })
    const index = schemas.value.findIndex((s) => s.productType === selected.value)
    if (index !== -1) schemas.value[index] = AdminAttributeSchema.parse(updated)
    saved.value = true
  } catch (err) {
    error.value = apiErrorMessage(err)
    if (typeof err === 'object' && err !== null && 'data' in err) {
      const parsed = ApiErrorBody.safeParse((err as { data: unknown }).data)
      if (parsed.success && parsed.data.error.fields) fieldErrors.value = parsed.data.error.fields
    }
  }
}

const rowErrors = (index: number) =>
  fieldErrors.value.filter((f) => f.path === `attributes.${index}` || f.path.startsWith(`attributes.${index}.`))
const otherErrors = computed(() => fieldErrors.value.filter((f) => !/^attributes\.\d+/.test(f.path)))

watch(selected, () => {
  saved.value = false
  reset()
})

await load()
</script>

<template>
  <div>
    <div class="admin-page-header">
      <div>
        <h1 class="admin-page-title">Schema thuộc tính động</h1>
        <p class="admin-page-desc">
          Mỗi nhóm hàng có một bộ thuộc tính dùng chung cho mọi danh mục bên trong. Cấu hình cấp sản phẩm vs biến thể,
          và quyết định thuộc tính nào dùng làm bộ lọc tìm kiếm cho khách hàng.
        </p>
      </div>

      <div class="admin-topbar-actions">
        <button type="button" class="btn btn-secondary" @click="reset">Bỏ thay đổi</button>
        <button type="button" class="btn btn-primary" @click="save">Lưu schema nhóm hàng ›</button>
      </div>
    </div>

    <div v-if="error" class="admin-alert admin-alert-danger" role="alert">
      <span>{{ error }}</span>
    </div>

    <div v-if="otherErrors.length" class="admin-alert admin-alert-danger" role="alert">
      <ul style="margin: 0; padding-left: 18px">
        <li v-for="item in otherErrors" :key="item.path">{{ item.message }}</li>
      </ul>
    </div>

    <div v-if="saved" class="admin-alert admin-alert-success" role="status">
      <span>✓ Đã lưu thành công schema thuộc tính cho nhóm {{ PRODUCT_TYPE_LABELS[selected] }}.</span>
    </div>

    <div class="tab-filter-bar" style="margin-bottom: 24px">
      <button
        v-for="productType in ProductType.options"
        :key="productType"
        type="button"
        class="tab-filter-btn"
        :class="{ active: selected === productType }"
        @click="selected = productType"
      >
        {{ PRODUCT_TYPE_LABELS[productType] }}
      </button>
    </div>

    <form @submit.prevent="save">
      <div class="admin-table-card">
        <div
          style="padding: 16px 20px; background: var(--adm-surface-subtle); border-bottom: 1px solid var(--adm-border)"
        >
          <div style="display: flex; justify-content: space-between; align-items: center">
            <h2 class="admin-section-title" style="margin: 0; font-size: 15px">
              Danh sách thuộc tính: {{ PRODUCT_TYPE_LABELS[selected] }}
            </h2>
            <button type="button" class="btn btn-secondary btn-sm" @click="add">+ Thêm thuộc tính</button>
          </div>
        </div>

        <div style="overflow-x: auto">
          <table class="admin-table">
            <thead>
              <tr>
                <th style="min-width: 140px">Khóa (Key)</th>
                <th style="min-width: 160px">Tên nhãn hiển thị</th>
                <th style="min-width: 130px">Kiểu dữ liệu</th>
                <th style="min-width: 180px">Giá trị cho phép / Đơn vị</th>
                <th style="min-width: 120px">Phân cấp</th>
                <th style="width: 80px; text-align: center">Bắt buộc</th>
                <th style="width: 80px; text-align: center">Bộ lọc</th>
                <th style="text-align: right; min-width: 130px">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in drafts" :key="index">
                <td>
                  <input
                    v-model="row.key"
                    class="form-input"
                    style="font-family: var(--adm-mono); font-size: 12px; padding: 4px 8px"
                    required
                    pattern="[a-z][a-z0-9_]*"
                    :readonly="row.key === GENDER_KEY"
                    :placeholder="row.key === GENDER_KEY ? 'gioi_tinh (Cố định)' : 'vi_du: chat_lieu'"
                  />
                  <small v-for="item in rowErrors(index)" :key="item.path" class="field-error-msg">
                    {{ item.message }}
                  </small>
                </td>

                <td>
                  <input
                    v-model="row.label"
                    class="form-input"
                    style="font-size: 13px; font-weight: 500; padding: 4px 8px"
                    required
                    placeholder="Tên nhãn tiếng Việt"
                  />
                </td>

                <td>
                  <select
                    aria-label="Kiểu dữ liệu"
                    v-model="row.type"
                    class="form-select"
                    style="font-size: 12px; padding: 4px 8px"
                    :disabled="row.key === GENDER_KEY"
                  >
                    <option v-for="(label, type) in TYPE_LABELS" :key="type" :value="type">{{ label }}</option>
                  </select>
                </td>

                <td>
                  <textarea
                    aria-label="Các lựa chọn, mỗi dòng một giá trị"
                    v-if="row.type === 'enum' || row.type === 'multi_enum'"
                    v-model="row.options"
                    class="form-textarea"
                    style="font-size: 12px; padding: 4px 8px"
                    rows="2"
                    placeholder="Mỗi dòng 1 giá trị..."
                    :readonly="row.key === GENDER_KEY"
                  />
                  <input
                    v-else-if="row.type === 'number'"
                    v-model="row.unit"
                    class="form-input"
                    style="font-size: 12px; padding: 4px 8px"
                    placeholder="Đơn vị (ví dụ: mm, ml)"
                  />
                  <span v-else style="color: var(--adm-muted); font-size: 12px">—</span>
                </td>

                <td>
                  <select
                    aria-label="Cấp áp dụng"
                    v-model="row.level"
                    class="form-select"
                    style="font-size: 12px; padding: 4px 8px"
                    :disabled="row.key === GENDER_KEY"
                  >
                    <option v-for="level in AttributeLevel.options" :key="level" :value="level">
                      {{ LEVEL_LABELS[level] }}
                    </option>
                  </select>
                </td>

                <td style="text-align: center">
                  <input aria-label="Bắt buộc" v-model="row.required" type="checkbox" style="cursor: pointer" />
                </td>

                <td style="text-align: center">
                  <input
                    aria-label="Dùng làm bộ lọc"
                    v-model="row.filterable"
                    type="checkbox"
                    style="cursor: pointer"
                    :disabled="row.key === GENDER_KEY"
                  />
                </td>

                <td style="text-align: right">
                  <div style="display: flex; justify-content: flex-end; gap: 4px">
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      style="padding: 2px 6px"
                      :disabled="index === 0"
                      title="Chuyển lên"
                      @click="move(index, -1)"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      style="padding: 2px 6px"
                      :disabled="index === drafts.length - 1"
                      title="Chuyển xuống"
                      @click="move(index, 1)"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      style="padding: 2px 6px; color: var(--adm-danger)"
                      :disabled="row.key === GENDER_KEY"
                      title="Xóa thuộc tính"
                      @click="drafts.splice(index, 1)"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          style="
            padding: 16px 20px;
            background: var(--adm-surface);
            border-top: 1px solid var(--adm-border);
            display: flex;
            justify-content: space-between;
          "
        >
          <button type="button" class="btn btn-secondary btn-sm" @click="add">+ Thêm dòng thuộc tính</button>
          <div style="display: flex; gap: 8px">
            <button type="button" class="btn btn-secondary btn-sm" @click="reset">Bỏ thay đổi</button>
            <button type="submit" class="btn btn-primary btn-sm">Lưu toàn bộ schema</button>
          </div>
        </div>
      </div>
    </form>
  </div>
</template>
