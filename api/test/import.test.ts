import { crc32 } from 'node:zlib'
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

async function post(request: Request, token: string, path: string, body: Record<string, unknown>) {
  const res = await request.post(path).set(bearer(token)).send(body)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

/** Owner đã đăng nhập; thương hiệu Nike, Chanel; danh mục Sneaker > Chạy bộ (giày dép) và Nước hoa nữ. */
async function shop() {
  const app = await appWithOwner()
  const { accessToken: token } = await login(app.request, OWNER.email, OWNER.password)
  await post(app.request, token, '/api/admin/brands', { name: 'Nike', slug: 'nike' })
  await post(app.request, token, '/api/admin/brands', { name: 'Chanel', slug: 'chanel' })
  const sneaker = await post(app.request, token, '/api/admin/categories', {
    name: 'Sneaker',
    slug: 'sneaker',
    productType: 'footwear',
  })
  await post(app.request, token, '/api/admin/categories', {
    name: 'Chạy bộ',
    slug: 'chay-bo',
    productType: 'footwear',
    parentId: sneaker.id,
  })
  await post(app.request, token, '/api/admin/categories', {
    name: 'Nước hoa nữ',
    slug: 'nuoc-hoa-nu',
    productType: 'fragrance',
  })
  return { ...app, token }
}

async function template(request: Request, token: string) {
  const res = await request.get('/api/admin/import/template').set(bearer(token)).responseType('blob')
  expect(res.status).toBe(200)
  expect(res.headers['content-disposition']).toContain('.xlsx')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(res.body as ArrayBuffer)
  return workbook
}

/** Key trong ngoặc vuông ở cuối tiêu đề cột, ví dụ `Màu [bt.mau]` → `bt.mau`. */
const keyOf = (header: unknown) => /\[([^\]]+)\]\s*$/.exec(String(header ?? ''))?.[1]

const headerKeys = (sheet: ExcelJS.Worksheet) => (sheet.getRow(1).values as unknown[]).slice(1).map(keyOf)

type Row = Record<string, string | number | boolean>

/** Điền các dòng vào sheet của file mẫu theo key cột, rồi trả file .xlsx. */
async function fill(workbook: ExcelJS.Workbook, sheetName: string, rows: Row[]) {
  const sheet = workbook.getWorksheet(sheetName)!
  const keys = headerKeys(sheet)
  rows.forEach((row, index) => {
    for (const [key, value] of Object.entries(row)) {
      const column = keys.indexOf(key)
      if (column < 0) throw new Error(`Sheet ${sheetName} không có cột ${key}`)
      sheet.getRow(index + 2).getCell(column + 1).value = value
    }
  })
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

const upload = (request: Request, token: string, step: 'preview' | 'commit', file: Buffer, name = 'hang-hoa.xlsx') =>
  request.post(`/api/admin/import/${step}`).set(bearer(token)).attach('file', file, name)

const shoeRow = (overrides: Row = {}): Row => ({
  slug: 'air-max-90',
  name: 'Air Max 90',
  brand: 'Nike',
  category: 'Sneaker > Chạy bộ',
  modelCode: 'CN8490-002',
  'sp.gioi_tinh': 'Nam',
  'sp.he_size': 'EU',
  sku: 'AM90-40',
  'bt.mau': 'Đen',
  'bt.size': '40',
  ...overrides,
})

describe('file mẫu', () => {
  it('mỗi nhóm hàng một sheet, cột sinh từ schema thuộc tính hiện tại', async () => {
    const { request, token } = await shop()

    const workbook = await template(request, token)
    const footwear = workbook.getWorksheet('Giày dép')!
    const fragrance = workbook.getWorksheet('Nước hoa')!

    for (const name of ['Giày dép', 'Quần áo', 'Đồng hồ', 'Túi xách', 'Nước hoa']) {
      expect(workbook.getWorksheet(name), name).toBeDefined()
    }
    expect(headerKeys(footwear)).toEqual([
      'slug',
      'name',
      'brand',
      'category',
      'modelCode',
      'description',
      'usageCare',
      'originStatement',
      'groundShippingOnly',
      'sp.gioi_tinh',
      'sp.he_size',
      'sp.chat_lieu',
      'sku',
      'bt.size',
      'bt.mau',
      'price',
      'compareAtPrice',
    ])
    expect(headerKeys(fragrance)).toEqual(expect.arrayContaining(['sp.nong_do', 'bt.dung_tich']))
  })

  it('thương hiệu, danh mục, giá trị enum có danh sách thả xuống; danh mục ghi theo đường dẫn trong nhóm hàng', async () => {
    const { request, token } = await shop()

    const workbook = await template(request, token)
    const footwear = workbook.getWorksheet('Giày dép')!
    const lists = workbook.getWorksheet('Danh sách')!
    const columnOf = (key: string) => headerKeys(footwear).indexOf(key) + 1
    /** Giá trị của vùng `'Danh sách'!$B$2:$B$5` trên sheet ẩn. */
    const listValues = (formula: string) => {
      const [, column, from, to] = /\$([A-Z]+)\$(\d+):\$[A-Z]+\$(\d+)/.exec(formula)!
      return Array.from(
        { length: Number(to) - Number(from) + 1 },
        (_, i) => lists.getCell(`${column}${Number(from) + i}`).value,
      )
    }
    const validation = (key: string) => footwear.getRow(5).getCell(columnOf(key)).dataValidation

    expect(lists.state).toBe('hidden')
    expect(listValues(validation('brand').formulae![0]!)).toEqual(['Chanel', 'Nike'])
    expect(listValues(validation('category').formulae![0]!)).toEqual(['Sneaker', 'Sneaker > Chạy bộ'])
    expect(listValues(validation('sp.he_size').formulae![0]!)).toEqual(['EU', 'US', 'UK', 'VN'])
    expect(validation('groundShippingOnly').formulae).toEqual(['"Có,Không"'])
  })
})

describe('xem trước và xác nhận', () => {
  it('file hợp lệ: xem trước không ghi gì, xác nhận tạo sản phẩm nháp kèm biến thể và giá', async () => {
    const { request, token } = await shop()
    const file = await fill(await template(request, token), 'Giày dép', [
      shoeRow({ price: 3_500_000, compareAtPrice: 4_000_000 }),
      shoeRow({ sku: 'AM90-41', 'bt.size': '41', price: 3_500_000 }),
    ])

    const preview = await upload(request, token, 'preview', file)
    const afterPreview = await request.get('/api/admin/products').set(bearer(token))
    const commit = await upload(request, token, 'commit', file)
    const products = await request.get('/api/admin/products').set(bearer(token))
    const detail = await request.get(`/api/admin/products/${products.body.items[0].id}`).set(bearer(token))

    expect(preview.status).toBe(200)
    expect(preview.body).toEqual({ products: 1, variants: 2, errors: [], warnings: [] })
    expect(afterPreview.body.items).toEqual([])
    expect(commit.status).toBe(201)
    expect(commit.body).toEqual({ products: 1, variants: 2 })
    expect(detail.body).toMatchObject({
      name: 'Air Max 90',
      slug: 'air-max-90',
      modelCode: 'CN8490-002',
      status: 'draft',
      attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
      variants: [
        { sku: 'AM90-40', attributes: { mau: 'Đen', size: '40' }, price: 3_500_000, compareAtPrice: 4_000_000 },
        { sku: 'AM90-41', attributes: { mau: 'Đen', size: '41' }, price: 3_500_000, compareAtPrice: null },
      ],
    })
  })

  it('một dòng lỗi thì xác nhận không ghi gì, kể cả các dòng hợp lệ', async () => {
    const { request, token } = await shop()
    const file = await fill(await template(request, token), 'Giày dép', [
      shoeRow(),
      shoeRow({ slug: 'pegasus-41', name: 'Pegasus 41', sku: 'PG41-40', 'sp.he_size': 'JP' }),
    ])

    const commit = await upload(request, token, 'commit', file)
    const products = await request.get('/api/admin/products').set(bearer(token))

    expect(commit.status).toBe(400)
    expect(commit.body.error.fields).toEqual([expect.objectContaining({ path: 'Giày dép / 3 / Hệ size' })])
    expect(products.body.items).toEqual([])
  })

  it('xem trước báo lỗi đúng sheet, dòng, cột: thuộc tính sai schema, thiếu trường bắt buộc, giá hãng thấp hơn giá bán', async () => {
    const { request, token } = await shop()
    const file = await fill(await template(request, token), 'Giày dép', [
      shoeRow({ 'sp.he_size': 'JP' }),
      shoeRow({ sku: 'AM90-41', 'bt.size': '41', price: 3_000_000, compareAtPrice: 2_000_000 }),
      shoeRow({ sku: 'AM90-42', 'bt.size': '' }),
    ])

    const preview = await upload(request, token, 'preview', file)

    expect(preview.status).toBe(200)
    expect(preview.body.products).toBe(0)
    expect(preview.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sheet: 'Giày dép', row: 2, column: 'Hệ size' }),
        expect.objectContaining({ sheet: 'Giày dép', row: 3, column: 'Giá hãng' }),
        expect.objectContaining({ sheet: 'Giày dép', row: 4, column: 'Size' }),
      ]),
    )
  })

  it('thương hiệu hoặc danh mục không có, danh mục của nhóm hàng khác, slug của sản phẩm có sẵn đều là lỗi', async () => {
    const { request, token } = await shop()
    const existing = await fill(await template(request, token), 'Giày dép', [shoeRow()])
    expect((await upload(request, token, 'commit', existing)).status).toBe(201)
    const file = await fill(await template(request, token), 'Giày dép', [
      shoeRow({ slug: 'a', sku: 'A-1', brand: 'Adidas' }),
      shoeRow({ slug: 'b', sku: 'B-1', category: 'Nước hoa nữ' }),
      shoeRow({ sku: 'AM90-99', 'bt.size': '99' }),
    ])

    const preview = await upload(request, token, 'preview', file)

    expect(preview.body.errors).toEqual([
      expect.objectContaining({ row: 2, column: 'Thương hiệu', message: expect.stringContaining('Adidas') }),
      expect.objectContaining({ row: 3, column: 'Danh mục' }),
      expect.objectContaining({ row: 4, column: 'Slug', message: expect.stringContaining('có sẵn') }),
    ])
  })

  it('dòng có SKU đã tồn tại được bỏ qua kèm cảnh báo, không sửa thông tin sản phẩm đã có', async () => {
    const { request, token } = await shop()
    const first = await fill(await template(request, token), 'Giày dép', [shoeRow({ price: 3_500_000 })])
    expect((await upload(request, token, 'commit', first)).status).toBe(201)
    const again = await fill(await template(request, token), 'Giày dép', [
      shoeRow({ name: 'Tên mới', price: 1_000_000 }),
      shoeRow({ slug: 'pegasus-41', name: 'Pegasus 41', sku: 'PG41-40' }),
    ])

    const preview = await upload(request, token, 'preview', again)
    const commit = await upload(request, token, 'commit', again)
    const products = await request.get('/api/admin/products').set(bearer(token))

    expect(preview.body).toMatchObject({ products: 1, variants: 1, errors: [] })
    expect(preview.body.warnings).toEqual([expect.objectContaining({ row: 2, column: 'SKU' })])
    expect(commit.body).toEqual({ products: 1, variants: 1 })
    expect(products.body.items.map((p: { name: string }) => p.name).sort()).toEqual(['Air Max 90', 'Pegasus 41'])
  })

  it('các dòng cùng slug phải giống nhau ở cột thông tin sản phẩm; SKU hoặc tổ hợp thuộc tính trùng trong file là lỗi', async () => {
    const { request, token } = await shop()
    const file = await fill(await template(request, token), 'Giày dép', [
      shoeRow(),
      shoeRow({ sku: 'AM90-41', 'bt.size': '41', name: 'Air Max 90 khác tên' }),
      shoeRow({ sku: 'AM90-40', 'bt.size': '42' }),
      shoeRow({ sku: 'AM90-43' }),
    ])

    const preview = await upload(request, token, 'preview', file)

    expect(preview.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, column: 'Tên sản phẩm' }),
        expect.objectContaining({ row: 4, column: 'SKU' }),
        expect.objectContaining({ row: 5, column: null, message: expect.stringContaining('tổ hợp') }),
      ]),
    )
  })

  it('import ghi audit cho từng sản phẩm, biến thể, giá và một bản tóm tắt catalog.import', async () => {
    const { request, token } = await shop()
    const file = await fill(await template(request, token), 'Giày dép', [shoeRow({ price: 3_500_000 })])

    await upload(request, token, 'commit', file, 'dot-1.xlsx')
    const audit = await request.get('/api/admin/audit').set(bearer(token))
    const actions = audit.body.items.map((e: { action: string }) => e.action)

    expect(actions).toEqual(
      expect.arrayContaining(['catalog.product.create', 'catalog.variant.create', 'price.change']),
    )
    expect(audit.body.items).toContainEqual(
      expect.objectContaining({
        action: 'catalog.import',
        after: { fileName: 'dot-1.xlsx', products: 1, variants: 1 },
      }),
    )
  })
})

describe('slug trùng giữa các sheet và file không tạo gì', () => {
  it('cùng một slug ở hai sheet là lỗi ngay khi xem trước, chỉ ra cả hai dòng', async () => {
    const { request, token } = await shop()
    const workbook = await template(request, token)
    await fill(workbook, 'Giày dép', [shoeRow({ slug: 'trung-slug' })])
    const file = await fill(workbook, 'Nước hoa', [
      {
        slug: 'trung-slug',
        name: 'No. 5',
        brand: 'Chanel',
        category: 'Nước hoa nữ',
        'sp.gioi_tinh': 'Nữ',
        'sp.nong_do': 'Parfum',
        sku: 'NO5-100',
        'bt.dung_tich': 100,
      },
    ])

    const preview = await upload(request, token, 'preview', file)

    expect(preview.body.errors).toEqual([
      expect.objectContaining({
        sheet: 'Nước hoa',
        row: 2,
        column: 'Slug',
        message: expect.stringContaining('Giày dép'),
      }),
    ])
  })

  it('mọi dòng đều có SKU đã tồn tại thì xác nhận trả 200, không ghi audit', async () => {
    const { request, token } = await shop()
    const file = await fill(await template(request, token), 'Giày dép', [shoeRow()])
    expect((await upload(request, token, 'commit', file)).status).toBe(201)

    const again = await upload(request, token, 'commit', file)
    const audit = await request.get('/api/admin/audit').query({ entityType: 'import' }).set(bearer(token))

    expect(again.status).toBe(200)
    expect(again.body).toEqual({ products: 0, variants: 0 })
    expect(audit.body.items).toHaveLength(1)
  })
})

describe('quyền và giới hạn', () => {
  it('có điền giá mà không có price.edit thì từ chối cả file; không điền giá thì import được', async () => {
    const { request, token } = await shop()
    const warehouseStaff = await createStaff(request, token, ['warehouse'], 'kho@example.com')
    const withPrice = await fill(await template(request, token), 'Giày dép', [shoeRow({ price: 3_500_000 })])
    const withoutPrice = await fill(await template(request, token), 'Giày dép', [shoeRow()])

    expect((await upload(request, warehouseStaff.accessToken, 'preview', withPrice)).status).toBe(403)
    expect((await upload(request, warehouseStaff.accessToken, 'commit', withPrice)).status).toBe(403)
    expect((await upload(request, warehouseStaff.accessToken, 'commit', withoutPrice)).status).toBe(201)
  })

  it('không có catalog.edit thì không tải được file mẫu hay import', async () => {
    const { request, token } = await shop()
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')

    expect((await request.get('/api/admin/import/template').set(bearer(accountant.accessToken))).status).toBe(403)
    expect((await upload(request, accountant.accessToken, 'preview', Buffer.from('x'))).status).toBe(403)
  })

  it('file không phải .xlsx hoặc quá 2.000 dòng biến thể bị từ chối', async () => {
    const { request, token } = await shop()
    const rows = Array.from({ length: 2001 }, (_, i) => shoeRow({ sku: `AM90-${i}`, 'bt.size': String(i) }))
    const tooMany = await fill(await template(request, token), 'Giày dép', rows)

    const notExcel = await upload(request, token, 'preview', Buffer.from('slug,name\nabc,Abc'), 'hang.xlsx')
    const big = await upload(request, token, 'preview', tooMany)

    expect(notExcel.status).toBe(400)
    expect(big.status).toBe(400)
    expect(big.body.error.message).toContain('2001')
  })

  it('file Word đổi đuôi thành .xlsx bị từ chối là "không phải Excel", không phải "thiếu sheet"', async () => {
    const { request, token } = await shop()
    const docx = zipOf({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w:document/>' })

    const res = await upload(request, token, 'preview', docx, 'hang-hoa.xlsx')

    expect(res.status).toBe(400)
    expect(res.body.error.message).toBe('File phải là Excel .xlsx')
  })

  it('file Excel không có sheet nhóm hàng nào bị từ chối kèm hướng dẫn dùng file mẫu', async () => {
    const { request, token } = await shop()
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Sheet1').addRow(['slug', 'name'])

    const res = await upload(request, token, 'preview', Buffer.from(await workbook.xlsx.writeBuffer()))

    expect(res.status).toBe(400)
    expect(res.body.error.message).toContain('file mẫu')
  })
})

/** File zip không nén, đủ để giả một file Office khác Excel (ví dụ .docx) mà không cần thêm thư viện. */
function zipOf(files: Record<string, string>) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const data = Buffer.from(content)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, data)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
