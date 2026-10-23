<script setup lang="ts">
import {
  AdminAttributeSchemaList,
  ApiErrorBody,
  AttributeLevel,
  GENDER_KEY,
  ProductType,
  type AdminAttributeSchema,
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
    case 'multi_enum':
      return { ...base, type: base.type, options: values }
    case 'number':
      return { ...base, type: 'number', unit: unit.trim() || null }
    default:
      return { ...base, type: base.type }
  }
}

function reset() {
  const schema = schemas.value.find((s) => s.productType === selected.value)
  drafts.value = schema ? schema.attributes.map(toDraft) : []
  error.value = null
  fieldErrors.value = []
}

async function load() {
  schemas.value = AdminAttributeSchemaList.parse(await session.adminFetch('/api/admin/attribute-schemas')).items
  reset()
}

function add() {
  drafts.value.push({
    key: '',
    label: '',
    type: 'text',
    level: 'product',
    required: false,
    filterable: false,
    options: '',
    unit: '',
  })
}

function move(index: number, by: -1 | 1) {
  const [row] = drafts.value.splice(index, 1)
  drafts.value.splice(index + by, 0, row!)
}

async function save() {
  error.value = null
  fieldErrors.value = []
  saved.value = false
  try {
    await session.adminFetch(`/api/admin/attribute-schemas/${selected.value}`, {
      method: 'PUT',
      body: { attributes: drafts.value.map(toDefinition) },
    })
    await load()
    saved.value = true
  } catch (err) {
    error.value = apiErrorMessage(err)
    const body = ApiErrorBody.safeParse((err as { data?: unknown }).data)
    fieldErrors.value = body.success ? (body.data.error.fields ?? []) : []
  }
}

/** Lỗi API trả cho dòng thứ `index`, đường dẫn dạng `attributes.<index>.<trường>`. */
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
  <main>
    <h1>Schema thuộc tính</h1>
    <p>
      Mỗi nhóm hàng có một bộ thuộc tính dùng chung cho mọi danh mục bên trong. Thứ tự dòng là thứ tự hiển thị trên
      website. Thêm thuộc tính bắt buộc, xóa thuộc tính hay bớt giá trị cho phép sẽ bị từ chối nếu có sản phẩm không còn
      hợp lệ. Mã mẫu, bảng size và hướng dẫn bảo quản là trường chung của sản phẩm, không khai báo ở đây.
    </p>

    <label>
      Nhóm hàng
      <select v-model="selected">
        <option v-for="productType in ProductType.options" :key="productType" :value="productType">
          {{ PRODUCT_TYPE_LABELS[productType] }}
        </option>
      </select>
    </label>

    <p v-if="error" role="alert">{{ error }}</p>
    <ul v-if="otherErrors.length" role="alert">
      <li v-for="item in otherErrors" :key="item.path">{{ item.message }}</li>
    </ul>
    <p v-if="saved" role="status">Đã lưu.</p>

    <form @submit.prevent="save">
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Nhãn</th>
            <th>Kiểu</th>
            <th>Giá trị cho phép / đơn vị</th>
            <th>Cấp</th>
            <th>Bắt buộc</th>
            <th>Bộ lọc</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in drafts" :key="index">
            <!-- Giới tính có ở mọi nhóm hàng với cấu hình cố định (ADR 0004); chỉ đổi được nhãn. -->
            <td>
              <input
                v-model="row.key"
                aria-label="Key"
                required
                pattern="[a-z][a-z0-9_]*"
                :readonly="row.key === GENDER_KEY"
              />
              <small v-for="item in rowErrors(index)" :key="item.path" role="alert">{{ item.message }}</small>
            </td>
            <td><input v-model="row.label" aria-label="Nhãn" required /></td>
            <td>
              <select v-model="row.type" aria-label="Kiểu" :disabled="row.key === GENDER_KEY">
                <option v-for="(label, type) in TYPE_LABELS" :key="type" :value="type">{{ label }}</option>
              </select>
            </td>
            <td>
              <textarea
                v-if="row.type === 'enum' || row.type === 'multi_enum'"
                v-model="row.options"
                aria-label="Giá trị cho phép, mỗi dòng một giá trị"
                rows="3"
                :readonly="row.key === GENDER_KEY"
              />
              <input v-else-if="row.type === 'number'" v-model="row.unit" aria-label="Đơn vị" placeholder="mm" />
            </td>
            <td>
              <select v-model="row.level" aria-label="Cấp" :disabled="row.key === GENDER_KEY">
                <option v-for="level in AttributeLevel.options" :key="level" :value="level">
                  {{ LEVEL_LABELS[level] }}
                </option>
              </select>
            </td>
            <td><input v-model="row.required" type="checkbox" aria-label="Bắt buộc" /></td>
            <td>
              <input
                v-model="row.filterable"
                type="checkbox"
                aria-label="Dùng làm bộ lọc"
                :disabled="row.key === GENDER_KEY"
              />
            </td>
            <td>
              <button type="button" :disabled="index === 0" @click="move(index, -1)">Lên</button>
              <button type="button" :disabled="index === drafts.length - 1" @click="move(index, 1)">Xuống</button>
              <button type="button" :disabled="row.key === GENDER_KEY" @click="drafts.splice(index, 1)">Xóa</button>
            </td>
          </tr>
        </tbody>
      </table>
      <button type="button" @click="add">Thêm thuộc tính</button>
      <button type="submit">Lưu schema</button>
      <button type="button" @click="reset">Bỏ thay đổi</button>
    </form>
  </main>
</template>
