import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import {
  IMPORT_MAX_ROWS,
  ProductRequest,
  ProductType,
  VariantRequest,
  checkAttributes,
  type AttributeDefinition,
  type AttributeValues,
  type ImportIssue,
} from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import { fileError } from '../media/upload.ts'
import { loadAttributeSchema } from './attribute-schemas.ts'

/** Tên sheet của từng nhóm hàng trong file import. */
const SHEET_NAMES: Record<ProductType, string> = {
  footwear: 'Giày dép',
  apparel: 'Quần áo',
  watch: 'Đồng hồ',
  bag: 'Túi xách',
  fragrance: 'Nước hoa',
}
const LIST_SHEET = 'Danh sách'
const YES = 'Có'
const NO = 'Không'

type CellValue = string | number | boolean | null

/** Một cột của sheet. Tiêu đề trong file là `<nhãn>[ *] [<key>]`; key trong ngoặc vuông là thứ dùng khi đọc lại. */
type Column = { key: string; label: string; required: boolean; definition?: AttributeDefinition }

const fixed = (key: string, label: string, required = false): Column => ({ key, label, required })

const PRODUCT_COLUMNS = [
  fixed('slug', 'Slug', true),
  fixed('name', 'Tên sản phẩm', true),
  fixed('brand', 'Thương hiệu', true),
  fixed('category', 'Danh mục', true),
  fixed('modelCode', 'Mã mẫu'),
  fixed('description', 'Mô tả'),
  fixed('usageCare', 'Hướng dẫn sử dụng, bảo quản'),
  fixed('originStatement', 'Thông tin nguồn gốc công bố'),
  fixed('groundShippingOnly', 'Chỉ giao đường bộ'),
]
const PRICE_KEYS = ['price', 'compareAtPrice']

/** Cột của một nhóm hàng: thông tin chung, thuộc tính cấp sản phẩm (`sp.`), SKU, thuộc tính cấp biến thể (`bt.`), giá. */
function columnsOf(definitions: readonly AttributeDefinition[]): Column[] {
  const attribute = (prefix: string) => (d: AttributeDefinition) => ({
    key: `${prefix}.${d.key}`,
    label: d.label,
    required: d.required,
    definition: d,
  })
  return [
    ...PRODUCT_COLUMNS,
    ...definitions.filter((d) => d.level === 'product').map(attribute('sp')),
    fixed('sku', 'SKU', true),
    ...definitions.filter((d) => d.level === 'variant').map(attribute('bt')),
    fixed('price', 'Giá bán'),
    fixed('compareAtPrice', 'Giá hãng'),
    fixed('openingStock', 'Tồn đầu kỳ'),
  ]
}

/** Cột thuộc phần thông tin sản phẩm: các dòng cùng slug phải giống nhau ở những cột này. */
const isProductColumn = (key: string) => key.startsWith('sp.') || PRODUCT_COLUMNS.some((c) => c.key === key)

const headerOf = (column: Column) => `${column.label}${column.required ? ' *' : ''} [${column.key}]`
const keyOf = (header: CellValue) => (typeof header === 'string' ? /\[([^\]]+)\]\s*$/.exec(header)?.[1] : undefined)

function columnLetter(index: number) {
  let n = index
  let letter = ''
  while (n > 0) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter
    n = Math.floor((n - 1) / 26)
  }
  return letter
}

// Dữ liệu tham chiếu: thương hiệu, danh mục theo đường dẫn, schema thuộc tính

/** Tên không có unique constraint, nên một tên có thể ứng với nhiều id; khi đó dòng import báo lỗi thay vì đoán. */
type NameIndex = Map<string, string[]>
const normalizeName = (name: string) => name.trim().toLowerCase()

function addName(index: NameIndex, name: string, id: string) {
  const key = normalizeName(name)
  index.set(key, [...(index.get(key) ?? []), id])
}

/** Danh mục ghi theo đường dẫn từ gốc của nhóm hàng, ví dụ `Sneaker > Chạy bộ`, vì tên danh mục có thể lặp ở nhánh khác. */
export async function loadReference(db: DbClient) {
  const [brands, categories, schemas] = await Promise.all([
    db.brand.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    db.category.findMany({ select: { id: true, name: true, parentId: true, productType: true } }),
    Promise.all(ProductType.options.map((type) => loadAttributeSchema(db, type))),
  ])
  const byId = new Map(categories.map((c) => [c.id, c]))
  const pathOf = (id: string): string => {
    const category = byId.get(id)!
    return category.parentId ? `${pathOf(category.parentId)} > ${category.name}` : category.name
  }

  const brandIndex: NameIndex = new Map()
  for (const b of brands) addName(brandIndex, b.name, b.id)
  const categoryPaths = Object.fromEntries(ProductType.options.map((t) => [t, [] as string[]])) as Record<
    ProductType,
    string[]
  >
  const categoryIndex = Object.fromEntries(ProductType.options.map((t) => [t, new Map()])) as Record<
    ProductType,
    NameIndex
  >
  for (const c of categories) {
    const path = pathOf(c.id)
    categoryPaths[c.productType].push(path)
    addName(categoryIndex[c.productType], path, c.id)
  }
  for (const paths of Object.values(categoryPaths)) paths.sort((a, b) => a.localeCompare(b, 'vi'))

  return {
    brandNames: brands.map((b) => b.name),
    brandIndex,
    categoryPaths,
    categoryIndex,
    definitions: Object.fromEntries(schemas.map((s) => [s.productType, s.attributes])) as Record<
      ProductType,
      AttributeDefinition[]
    >,
  }
}
export type Reference = Awaited<ReturnType<typeof loadReference>>

// File mẫu

/**
 * exceljs 4.4 có `worksheet.dataValidations.add(range, …)` nhưng bộ type không khai báo. Gắn validation cho cả vùng
 * thay vì từng ô, để file mẫu không phình ra vì 2.000 dòng × nhiều cột.
 */
type WithRangeValidations = ExcelJS.Worksheet & {
  dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void }
}

/** File mẫu sinh từ dữ liệu hiện tại; danh sách thả xuống đặt ở một sheet ẩn để không vướng giới hạn 255 ký tự của Excel. */
export async function buildTemplate(ref: Reference): Promise<Buffer> {
  const lists: { title: string; values: string[] }[] = []
  /** Đăng ký một danh sách, trả về vùng ô trên sheet ẩn để dùng trong data validation. */
  const listRange = (title: string, values: string[]) => {
    if (values.length === 0) return null
    lists.push({ title, values })
    const letter = columnLetter(lists.length)
    return `'${LIST_SHEET}'!$${letter}$2:$${letter}$${values.length + 1}`
  }
  const brands = listRange('Thương hiệu', ref.brandNames)
  const yesNo = `"${YES},${NO}"`

  const workbook = new ExcelJS.Workbook()
  for (const type of ProductType.options) {
    const sheet = workbook.addWorksheet(SHEET_NAMES[type], { views: [{ state: 'frozen', ySplit: 1 }] })
    const columns = columnsOf(ref.definitions[type])
    sheet.addRow(columns.map(headerOf)).font = { bold: true }
    const categories = listRange(`Danh mục ${SHEET_NAMES[type]}`, ref.categoryPaths[type])

    columns.forEach((column, index) => {
      sheet.getColumn(index + 1).width = Math.max(14, column.label.length + column.key.length + 6)
      const d = column.definition
      const formula =
        column.key === 'brand'
          ? brands
          : column.key === 'category'
            ? categories
            : column.key === 'groundShippingOnly' || d?.type === 'boolean'
              ? yesNo
              : d?.type === 'enum'
                ? listRange(`${SHEET_NAMES[type]} - ${d.label}`, d.options)
                : null
      if (!formula) return
      const letter = columnLetter(index + 1)
      ;(sheet as WithRangeValidations).dataValidations.add(`${letter}2:${letter}${IMPORT_MAX_ROWS + 1}`, {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: true,
        errorTitle: column.label,
        error: 'Chọn một giá trị trong danh sách',
      })
    })
  }

  const listSheet = workbook.addWorksheet(LIST_SHEET, { state: 'hidden' })
  lists.forEach(({ title, values }, index) => {
    listSheet.getCell(1, index + 1).value = title
    values.forEach((value, row) => (listSheet.getCell(row + 2, index + 1).value = value))
  })
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

// Đọc file

/** Một dòng dữ liệu, giá trị theo key cột. */
export type SheetRow = { productType: ProductType; sheet: string; row: number; values: Map<string, CellValue> }

function cellValue(cell: ExcelJS.Cell): CellValue {
  const value = cell.value
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if ('result' in value) return value.result === undefined ? null : cellValue({ value: value.result } as ExcelJS.Cell)
  if ('richText' in value) return cellValue({ value: value.richText.map((r) => r.text).join('') } as ExcelJS.Cell)
  if ('text' in value) return cellValue({ value: value.text } as ExcelJS.Cell)
  return null
}

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04])

/** Đọc mọi sheet nhóm hàng; sheet khác (kể cả sheet danh sách) bị bỏ qua. Lỗi cấu trúc trả về như lỗi của file. */
export async function readWorkbook(buffer: Buffer, ref: Reference) {
  // .xlsx là file zip; kiểm nội dung thật thay vì tin đuôi file.
  if (!buffer.subarray(0, 4).equals(ZIP_MAGIC)) throw fileError(400, 'File phải là Excel .xlsx')
  const workbook = new ExcelJS.Workbook()
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  } catch {
    throw fileError(400, 'Không đọc được file Excel .xlsx')
  }
  // File Office khác (như .docx) cũng là zip và exceljs đọc không lỗi, nhưng không có sheet nào; .xlsx luôn có ít nhất một.
  if (workbook.worksheets.length === 0) throw fileError(400, 'File phải là Excel .xlsx')
  if (!ProductType.options.some((type) => workbook.getWorksheet(SHEET_NAMES[type]))) {
    const names = ProductType.options.map((type) => SHEET_NAMES[type]).join(', ')
    throw fileError(400, `File không có sheet nhóm hàng nào (${names}); hãy tải file mẫu rồi điền vào đó`)
  }

  const rows: SheetRow[] = []
  const errors: ImportIssue[] = []
  for (const type of ProductType.options) {
    const sheetName = SHEET_NAMES[type]
    const sheet = workbook.getWorksheet(sheetName)
    if (!sheet) continue
    const keys = new Map<number, string>()
    sheet.getRow(1).eachCell((cell, column) => {
      const key = keyOf(cellValue(cell))
      if (key) keys.set(column, key)
    })
    const present = new Set(keys.values())
    const missing = columnsOf(ref.definitions[type]).filter((c) => c.required && !present.has(c.key))
    for (const column of missing) {
      errors.push({
        sheet: sheetName,
        row: null,
        column: column.label,
        message: 'Thiếu cột này; hãy dùng file mẫu mới',
      })
    }
    if (missing.length) continue

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return
      const values = new Map<string, CellValue>()
      for (const [column, key] of keys) values.set(key, cellValue(row.getCell(column)))
      if ([...values.values()].some((v) => v !== null))
        rows.push({ productType: type, sheet: sheetName, row: rowNumber, values })
    })
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    throw fileError(400, `File có ${rows.length} dòng biến thể, tối đa ${IMPORT_MAX_ROWS}; hãy chia thành nhiều file`)
  }
  return { rows, errors }
}

const filled = (rows: readonly SheetRow[], keys: readonly string[]) =>
  rows.some((r) => keys.some((key) => r.values.get(key) !== null && r.values.get(key) !== undefined))

/** File có điền ô giá nào không; có thì cần quyền `price.edit`. */
export const hasPrices = (rows: readonly SheetRow[]) => filled(rows, PRICE_KEYS)

/** File có điền ô tồn đầu kỳ nào không; có thì cần quyền `stock.adjust`. */
export const hasOpeningStock = (rows: readonly SheetRow[]) => filled(rows, ['openingStock'])

/** Tồn đầu kỳ: số nguyên không âm; trống thì `null`; sai thì `NaN`. */
function parseOpeningStock(value: CellValue | undefined): number | null {
  const n = parsePrice(value)
  return n === null || (Number.isInteger(n) && n >= 0 && n <= 1_000_000) ? n : Number.NaN
}

const OPENING_STOCK_ERROR = 'Tồn đầu kỳ phải là số nguyên không âm'
export const ALREADY_LEDGERED =
  'Biến thể đã có dòng trong sổ xuất nhập; tồn đầu kỳ chỉ ghi một lần, hãy dùng điều chỉnh ở trang Tồn kho'

// Kiểm và lập kế hoạch tạo

const text = (value: CellValue | undefined) => (value === null || value === undefined ? '' : String(value))

function parseBoolean(value: CellValue | undefined): boolean | null | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'boolean') return value
  const v = normalizeName(String(value))
  return v === normalizeName(YES) ? true : v === normalizeName(NO) ? false : null
}

/** Giá ghi bằng số, hoặc chuỗi chữ số có dấu phân cách hàng nghìn ("3.500.000"); không đọc được thì `NaN`. */
function parsePrice(value: CellValue | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  const digits = String(value).replace(/[.,\s]/g, '')
  return /^\d+$/.test(digits) ? Number(digits) : Number.NaN
}

/** Giá trị ô thành giá trị thuộc tính; kiểu sai thì để nguyên cho `checkAttributes` báo lỗi. */
function attributeValue(definition: AttributeDefinition, value: CellValue): unknown {
  if (value === null) return undefined
  switch (definition.type) {
    case 'multi_enum':
      return String(value)
        .split(';')
        .map((v) => v.trim())
        .filter(Boolean)
    case 'number': {
      if (typeof value === 'number') return value
      const normalized = String(value).replace(',', '.')
      return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : value
    }
    case 'boolean':
      return parseBoolean(value) ?? value
    default:
      return String(value)
  }
}

function attributesOf(row: SheetRow, definitions: readonly AttributeDefinition[], prefix: 'sp' | 'bt') {
  const level = prefix === 'sp' ? 'product' : 'variant'
  const input: Record<string, unknown> = {}
  for (const d of definitions) {
    if (d.level !== level) continue
    const value = attributeValue(d, row.values.get(`${prefix}.${d.key}`) ?? null)
    if (value !== undefined) input[d.key] = value
  }
  return input
}

export type PlannedVariant = {
  sku: string
  attributes: AttributeValues
  price: number | null
  compareAtPrice: number | null
  sortOrder: number
  /** Lớn hơn 0 thì ghi tồn đầu kỳ ngay sau khi tạo. */
  openingStock: number
  sheet: string
  row: number
}
/** Tồn đầu kỳ cho biến thể đã có (dòng có SKU đã tồn tại). */
export type PlannedOpening = { variantId: string; sku: string; quantity: number; sheet: string; row: number }
export type PlannedProduct = {
  productType: ProductType
  brandId: string
  categoryId: string
  name: string
  slug: string
  modelCode: string
  description: string
  usageCare: string
  originStatement: string
  attributes: AttributeValues
  groundShippingOnly: boolean
  variants: PlannedVariant[]
}

/** Đường dẫn lỗi của zod (trường của request) → key cột. */
const COLUMN_OF_FIELD: Record<string, string> = { brandId: 'brand', categoryId: 'category' }

/**
 * Kiểm cả file và lập danh sách sản phẩm sẽ tạo. Dòng có SKU đã tồn tại chỉ dùng cột tồn đầu kỳ (các cột khác bỏ
 * qua, có cảnh báo); slug đã thuộc về sản phẩm có sẵn là lỗi, vì import không thêm biến thể vào sản phẩm đã có.
 * Gọi trong transaction khi xác nhận; việc biến thể chưa có dòng sổ được kiểm lại dưới khóa lúc ghi.
 */
export async function planImport(db: DbClient, rows: readonly SheetRow[], ref: Reference) {
  const errors: ImportIssue[] = []
  const warnings: ImportIssue[] = []
  const labels = new Map<string, Map<string, string>>()
  const labelOf = (row: SheetRow, key: string) => {
    if (!labels.has(row.sheet)) {
      labels.set(row.sheet, new Map(columnsOf(ref.definitions[row.productType]).map((c) => [c.key, c.label])))
    }
    return labels.get(row.sheet)!.get(key) ?? key
  }
  const issue = (row: SheetRow, key: string | null, message: string): ImportIssue => ({
    sheet: row.sheet,
    row: row.row,
    column: key === null ? null : labelOf(row, key),
    message,
  })
  const fieldErrors = (row: SheetRow, fields: { path: string; message: string }[], prefix: 'sp' | 'bt') => {
    for (const f of fields) {
      const [head, key] = f.path.split('.')
      errors.push(
        issue(row, head === 'attributes' && key ? `${prefix}.${key}` : (COLUMN_OF_FIELD[head!] ?? head!), f.message),
      )
    }
  }

  const skuOf = (row: SheetRow) => text(row.values.get('sku')).trim().toUpperCase()
  const [existingSkus, existingSlugs] = await Promise.all([
    db.productVariant.findMany({
      where: { sku: { in: rows.map(skuOf).filter(Boolean) } },
      select: { id: true, sku: true, _count: { select: { stockMovements: true } } },
    }),
    db.product.findMany({
      where: { slug: { in: rows.map((r) => text(r.values.get('slug')).trim()) } },
      select: { slug: true },
    }),
  ])
  const takenSkus = new Map(existingSkus.map((v) => [v.sku, v]))
  const takenSlugs = new Set(existingSlugs.map((p) => p.slug))

  const openings: PlannedOpening[] = []
  const groups = new Map<string, SheetRow[]>()
  for (const row of rows) {
    const existing = takenSkus.get(skuOf(row))
    if (existing) {
      const quantity = parseOpeningStock(row.values.get('openingStock'))
      if (Number.isNaN(quantity)) errors.push(issue(row, 'openingStock', OPENING_STOCK_ERROR))
      else if (!quantity) warnings.push(issue(row, 'sku', `SKU ${existing.sku} đã có; dòng này được bỏ qua`))
      else if (existing._count.stockMovements > 0) errors.push(issue(row, 'openingStock', ALREADY_LEDGERED))
      else {
        warnings.push(issue(row, 'sku', `SKU ${existing.sku} đã có; chỉ ghi tồn đầu kỳ, các cột khác được bỏ qua`))
        openings.push({ variantId: existing.id, sku: existing.sku, quantity, sheet: row.sheet, row: row.row })
      }
      continue
    }
    const key = `${row.productType}:${text(row.values.get('slug')).trim()}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  const seenSkus = new Map<string, SheetRow>()
  /** Dòng đầu tiên dùng mỗi slug; nhóm theo cả nhóm hàng nên cùng slug ở hai sheet phải bắt riêng ở đây. */
  const slugOwners = new Map<string, SheetRow>()
  const products: PlannedProduct[] = []
  for (const group of groups.values()) {
    const [first] = group as [SheetRow, ...SheetRow[]]
    const definitions = ref.definitions[first.productType]
    let ok = true
    const fail = (row: SheetRow, key: string | null, message: string) => {
      errors.push(issue(row, key, message))
      ok = false
    }

    const slug = text(first.values.get('slug')).trim()
    const owner = slugOwners.get(slug)
    if (owner && slug)
      fail(first, 'slug', `Slug này đã dùng cho sản phẩm khác ở sheet ${owner.sheet} dòng ${owner.row}`)
    else slugOwners.set(slug, first)

    const resolve = (index: NameIndex, key: string, what: string) => {
      const name = text(first.values.get(key))
      if (!name) return null
      const ids = index.get(normalizeName(name)) ?? []
      if (ids.length === 1) return ids[0]!
      fail(
        first,
        key,
        ids.length
          ? `Có nhiều ${what} cùng tên "${name}"; đổi tên cho khác nhau rồi tải lại file mẫu`
          : `Không có ${what} "${name}"`,
      )
      return null
    }
    const brandId = resolve(ref.brandIndex, 'brand', 'thương hiệu')
    const categoryId = resolve(
      ref.categoryIndex[first.productType],
      'category',
      `danh mục ${SHEET_NAMES[first.productType]}`,
    )

    const shipping = parseBoolean(first.values.get('groundShippingOnly'))
    if (shipping === null) fail(first, 'groundShippingOnly', `Chỉ nhận "${YES}" hoặc "${NO}"`)
    const product = ProductRequest.safeParse({
      // Id giả để zod kiểm các trường khác; thương hiệu, danh mục sai đã báo lỗi ở trên.
      brandId: brandId ?? randomUUID(),
      categoryId: categoryId ?? randomUUID(),
      name: text(first.values.get('name')),
      slug: text(first.values.get('slug')).trim(),
      modelCode: text(first.values.get('modelCode')),
      description: text(first.values.get('description')),
      usageCare: text(first.values.get('usageCare')),
      originStatement: text(first.values.get('originStatement')),
      groundShippingOnly: shipping ?? false,
    })
    if (!product.success) {
      ok = false
      fieldErrors(
        first,
        product.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
        'sp',
      )
    } else if (takenSlugs.has(product.data.slug)) {
      fail(first, 'slug', 'Slug này đã thuộc về một sản phẩm có sẵn; import không thêm biến thể vào sản phẩm đã có')
    }
    const productAttributes = checkAttributes(definitions, 'product', attributesOf(first, definitions, 'sp'))
    if (!productAttributes.ok) {
      ok = false
      fieldErrors(first, productAttributes.fields, 'sp')
    }

    const variants: PlannedVariant[] = []
    group.forEach((row, index) => {
      for (const [key, value] of first.values) {
        if (isProductColumn(key) && row !== first && text(row.values.get(key)) !== text(value)) {
          fail(row, key, `Các dòng cùng slug phải giống nhau ở cột này (dòng ${first.row} ghi "${text(value)}")`)
        }
      }
      const price = parsePrice(row.values.get('price'))
      const compareAtPrice = parsePrice(row.values.get('compareAtPrice'))
      for (const [key, value] of [
        ['price', price],
        ['compareAtPrice', compareAtPrice],
      ] as const) {
        if (Number.isNaN(value)) fail(row, key, 'Giá phải là số nguyên VND')
      }
      const openingStock = parseOpeningStock(row.values.get('openingStock'))
      if (Number.isNaN(openingStock)) fail(row, 'openingStock', OPENING_STOCK_ERROR)
      const variant = VariantRequest.safeParse({
        sku: text(row.values.get('sku')),
        price: Number.isNaN(price) ? null : price,
        compareAtPrice: Number.isNaN(compareAtPrice) ? null : compareAtPrice,
      })
      const attributes = checkAttributes(definitions, 'variant', attributesOf(row, definitions, 'bt'))
      if (!variant.success) {
        ok = false
        fieldErrors(
          row,
          variant.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
          'bt',
        )
      }
      if (!attributes.ok) {
        ok = false
        fieldErrors(row, attributes.fields, 'bt')
      }
      if (!variant.success || !attributes.ok) return

      const { sku } = variant.data
      const other = seenSkus.get(sku)
      if (other) return fail(row, 'sku', `SKU ${sku} đã có ở ${other.sheet} dòng ${other.row}`)
      seenSkus.set(sku, row)
      const v = { price: variant.data.price ?? null, compareAtPrice: variant.data.compareAtPrice ?? null }
      if (v.compareAtPrice !== null && (v.price === null || v.compareAtPrice < v.price)) {
        return fail(row, 'compareAtPrice', 'Giá hãng phải để trống hoặc không thấp hơn giá bán')
      }
      if (variants.some((p) => JSON.stringify(p.attributes) === JSON.stringify(attributes.values))) {
        return fail(row, null, 'Sản phẩm đã có biến thể với tổ hợp thuộc tính này ở dòng khác')
      }
      variants.push({
        sku,
        attributes: attributes.values,
        ...v,
        sortOrder: index,
        openingStock: Number.isNaN(openingStock) ? 0 : (openingStock ?? 0),
        sheet: row.sheet,
        row: row.row,
      })
    })

    if (ok && product.success && productAttributes.ok && brandId && categoryId) {
      const { sizeChart: _sizeChart, attributes: _attributes, ...data } = product.data
      products.push({
        ...data,
        productType: first.productType,
        brandId,
        categoryId,
        attributes: productAttributes.values,
        variants,
      })
    }
  }

  const openingStocks = openings.length + products.flatMap((p) => p.variants).filter((v) => v.openingStock > 0).length
  return { products, openings, openingStocks, errors, warnings }
}
