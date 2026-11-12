import { z } from 'zod'
import { ProductType } from './catalog.ts'
import type { FieldError } from './errors.ts'

/** Cấp áp dụng: một giá trị chung cho cả sản phẩm, hay phân biệt các biến thể với nhau. */
export const AttributeLevel = z.enum(['product', 'variant'])
export type AttributeLevel = z.infer<typeof AttributeLevel>

/** Thuộc tính giới tính có ở mọi nhóm hàng với đúng ba giá trị này (ADR 0004). */
export const GENDER_KEY = 'gioi_tinh'
export const GENDER_UNISEX = 'Unisex'
export const GENDER_OPTIONS = ['Nam', 'Nữ', GENDER_UNISEX] as const

const Options = z
  .array(z.string().trim().min(1).max(100))
  .min(1)
  .refine((options) => new Set(options).size === options.length, 'Giá trị cho phép bị trùng')

const Base = z.object({
  /** Key ổn định, là tên trường trong JSONB thuộc tính của sản phẩm và biến thể. */
  key: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/, 'Key chỉ gồm chữ thường không dấu, số và dấu gạch dưới'),
  label: z.string().trim().min(1).max(100),
  required: z.boolean(),
  level: AttributeLevel,
  filterable: z.boolean(),
})

/** Một định nghĩa thuộc tính. Thứ tự hiển thị là thứ tự trong danh sách của schema. */
export const AttributeDefinition = z.discriminatedUnion('type', [
  Base.extend({ type: z.literal('enum'), options: Options }),
  Base.extend({ type: z.literal('multi_enum'), options: Options }),
  Base.extend({ type: z.literal('text') }),
  Base.extend({ type: z.literal('number'), unit: z.string().trim().max(20).nullable() }),
  Base.extend({ type: z.literal('boolean') }),
])
export type AttributeDefinition = z.infer<typeof AttributeDefinition>
export type AttributeType = AttributeDefinition['type']

/** Danh sách định nghĩa: key không trùng, luôn có giới tính cấp sản phẩm đúng ba giá trị và dùng làm bộ lọc. */
export const AttributeDefinitions = z.array(AttributeDefinition).superRefine((attributes, ctx) => {
  const seen = new Set<string>()
  attributes.forEach(({ key }, index) => {
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index, 'key'], message: 'Key bị trùng' })
    seen.add(key)
  })
  const gender = attributes.find((a) => a.key === GENDER_KEY)
  const valid =
    gender?.type === 'enum' &&
    gender.level === 'product' &&
    gender.filterable &&
    gender.options.length === GENDER_OPTIONS.length &&
    GENDER_OPTIONS.every((option) => gender.options.includes(option))
  if (!valid) {
    ctx.addIssue({
      code: 'custom',
      path: [],
      message: `Mọi nhóm hàng phải có thuộc tính "${GENDER_KEY}" cấp sản phẩm, kiểu enum Nam / Nữ / Unisex, dùng làm bộ lọc`,
    })
  }
})

export const UpdateAttributeSchemaRequest = z.object({ attributes: AttributeDefinitions })
export type UpdateAttributeSchemaRequest = z.infer<typeof UpdateAttributeSchemaRequest>

export const AttributeSchema = z.object({
  productType: ProductType,
  attributes: z.array(AttributeDefinition),
})
export type AttributeSchema = z.infer<typeof AttributeSchema>

export const AdminAttributeSchema = AttributeSchema.extend({ updatedAt: z.string() })
export type AdminAttributeSchema = z.infer<typeof AdminAttributeSchema>

export const AdminAttributeSchemaList = z.object({ items: z.array(AdminAttributeSchema) })
export type AdminAttributeSchemaList = z.infer<typeof AdminAttributeSchemaList>

/** Giá trị thuộc tính đã kiểm, lưu dạng JSONB ở sản phẩm hoặc biến thể. */
export const AttributeValue = z.union([z.string(), z.array(z.string()), z.number(), z.boolean()])
export type AttributeValue = z.infer<typeof AttributeValue>
export const AttributeValues = z.record(z.string(), AttributeValue)
export type AttributeValues = z.infer<typeof AttributeValues>

export const ValidateAttributesRequest = z.object({
  level: AttributeLevel,
  attributes: z.record(z.string(), z.unknown()),
})
export type ValidateAttributesRequest = z.infer<typeof ValidateAttributesRequest>

export const ValidateAttributesResponse = z.object({
  attributes: AttributeValues,
})
export type ValidateAttributesResponse = z.infer<typeof ValidateAttributesResponse>

export type AttributeCheck = { ok: true; values: AttributeValues } | { ok: false; fields: FieldError[] }

/**
 * Kiểm giá trị thuộc tính của một cấp theo schema. Lỗi trả theo từng trường, đường dẫn `<path>.<key>`.
 * `null` coi như bỏ trống; giá trị trả về đã bỏ các trường trống và cắt khoảng trắng của text.
 */
export function checkAttributes(
  definitions: readonly AttributeDefinition[],
  level: AttributeLevel,
  input: Record<string, unknown>,
  path = 'attributes',
): AttributeCheck {
  const fields: FieldError[] = []
  const values: AttributeValues = {}
  const own = definitions.filter((d) => d.level === level)
  const error = (key: string, message: string) => fields.push({ path: `${path}.${key}`, message })

  for (const key of Object.keys(input)) {
    if (!own.some((d) => d.key === key)) error(key, 'Thuộc tính không có trong schema của nhóm hàng')
  }
  for (const definition of own) {
    const raw = input[definition.key]
    const value = typeof raw === 'string' ? raw.trim() : raw
    const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
    if (empty) {
      if (definition.required) error(definition.key, `Thiếu "${definition.label}"`)
      continue
    }
    const message = invalid(definition, value)
    if (message) error(definition.key, message)
    else values[definition.key] = value as AttributeValue
  }
  return fields.length ? { ok: false, fields } : { ok: true, values }
}

/** Lý do giá trị không hợp lệ, hoặc `null` khi hợp lệ. */
function invalid(definition: AttributeDefinition, value: unknown): string | null {
  switch (definition.type) {
    case 'text':
      return typeof value === 'string' ? null : 'Phải là chuỗi'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : 'Phải là số'
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Phải là đúng hoặc sai'
    case 'enum':
      if (typeof value !== 'string') return 'Phải là một giá trị trong danh sách'
      return definition.options.includes(value) ? null : `Giá trị "${value}" không nằm trong danh sách cho phép`
    case 'multi_enum': {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return 'Phải là danh sách giá trị'
      if (new Set(value).size !== value.length) return 'Giá trị bị trùng'
      const unknown = value.filter((v) => !definition.options.includes(v))
      return unknown.length ? `Giá trị "${unknown.join('", "')}" không nằm trong danh sách cho phép` : null
    }
  }
}
