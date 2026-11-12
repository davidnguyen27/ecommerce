import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'
import { createTestApp } from './support/test-app.ts'

async function ownerSession() {
  const app = await appWithOwner()
  const { accessToken } = await login(app.request, OWNER.email, OWNER.password)
  return { ...app, token: accessToken }
}

function validate(request: Request, token: string, productType: string, body: Record<string, unknown>) {
  return request.post(`/api/admin/attribute-schemas/${productType}/validate`).set(bearer(token)).send(body)
}

const GENDER = {
  key: 'gioi_tinh',
  label: 'Giới tính',
  type: 'enum',
  options: ['Nam', 'Nữ', 'Unisex'],
  required: true,
  level: 'product',
  filterable: true,
}

describe('schema thuộc tính seed sẵn', () => {
  it('cả năm nhóm hàng đều có schema, đứng đầu là giới tính cấp sản phẩm dùng làm bộ lọc', async () => {
    const { request } = await createTestApp()

    for (const productType of ['footwear', 'apparel', 'watch', 'bag', 'fragrance']) {
      const res = await request.get(`/api/attribute-schemas/${productType}`)

      expect(res.status).toBe(200)
      expect(res.body.productType).toBe(productType)
      expect(res.body.attributes[0]).toEqual(GENDER)
      expect(res.body.attributes.length).toBeGreaterThan(2)
    }
  })

  it('giày dép có hệ size, size, màu, chất liệu; nước hoa có dung tích theo ml, nồng độ, nhóm hương', async () => {
    const { request } = await createTestApp()

    const footwear = await request.get('/api/attribute-schemas/footwear')
    const fragrance = await request.get('/api/attribute-schemas/fragrance')

    const keys = (body: { attributes: { key: string }[] }) => body.attributes.map((a) => a.key)
    expect(keys(footwear.body)).toEqual(expect.arrayContaining(['he_size', 'size', 'mau', 'chat_lieu']))
    expect(keys(fragrance.body)).toEqual(expect.arrayContaining(['dung_tich', 'nong_do', 'nhom_huong']))
    expect(fragrance.body.attributes).toContainEqual(
      expect.objectContaining({ key: 'dung_tich', type: 'number', unit: 'ml', level: 'variant' }),
    )
  })

  it('mã mẫu là trường chung của sản phẩm, không nằm trong schema của nhóm hàng nào', async () => {
    const { request } = await createTestApp()

    for (const productType of ['footwear', 'apparel', 'watch', 'bag', 'fragrance']) {
      const res = await request.get(`/api/attribute-schemas/${productType}`)
      const labels = res.body.attributes.map((a: { key: string; label: string }) => `${a.key} ${a.label}`)
      expect(labels.join('|')).not.toMatch(/ma_mau|mã mẫu/i)
    }
  })

  it('nhóm hàng không tồn tại thì 400', async () => {
    const { request } = await createTestApp()

    const res = await request.get('/api/attribute-schemas/electronics')

    expect(res.status).toBe(400)
  })
})

describe('kiểm thuộc tính theo schema', () => {
  it('thuộc tính hợp lệ thì trả lại giá trị đã chuẩn hóa', async () => {
    const { request, token } = await ownerSession()

    const product = await validate(request, token, 'fragrance', {
      level: 'product',
      attributes: { gioi_tinh: 'Unisex', nong_do: 'Eau de Parfum', nhom_huong: ['Hương gỗ', 'Hương hoa'] },
    })
    const variant = await validate(request, token, 'fragrance', {
      level: 'variant',
      attributes: { dung_tich: 100, dang_dong_goi: null },
    })

    expect(product.status).toBe(200)
    expect(product.body.attributes).toEqual({
      gioi_tinh: 'Unisex',
      nong_do: 'Eau de Parfum',
      nhom_huong: ['Hương gỗ', 'Hương hoa'],
    })
    expect(variant.status).toBe(200)
    expect(variant.body.attributes).toEqual({ dung_tich: 100 })
  })

  it('thiếu trường bắt buộc thì lỗi ở đúng trường đó', async () => {
    const { request, token } = await ownerSession()

    const res = await validate(request, token, 'watch', {
      level: 'product',
      attributes: { gioi_tinh: 'Nam', kich_thuoc_mat: 40 },
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.fields).toEqual([{ path: 'attributes.loai_bo_may', message: expect.any(String) }])
  })

  it('sai kiểu thì lỗi theo từng trường', async () => {
    const { request, token } = await ownerSession()

    const product = await validate(request, token, 'fragrance', {
      level: 'product',
      attributes: { gioi_tinh: 'Nữ', nong_do: 42, nhom_huong: 'Hương gỗ' },
    })
    const variant = await validate(request, token, 'fragrance', {
      level: 'variant',
      attributes: { dung_tich: '100ml' },
    })

    expect(product.status).toBe(400)
    expect(product.body.error.fields.map((f: { path: string }) => f.path)).toEqual([
      'attributes.nong_do',
      'attributes.nhom_huong',
    ])
    expect(variant.status).toBe(400)
    expect(variant.body.error.fields).toEqual([{ path: 'attributes.dung_tich', message: expect.any(String) }])
  })

  it('giá trị enum không nằm trong danh sách thì bị từ chối, kể cả trong multi_enum', async () => {
    const { request, token } = await ownerSession()

    const res = await validate(request, token, 'fragrance', {
      level: 'product',
      attributes: { gioi_tinh: 'Trẻ em', nong_do: 'Parfum', nhom_huong: ['Hương gỗ', 'Hương biển'] },
    })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([
      { path: 'attributes.gioi_tinh', message: expect.stringContaining('Trẻ em') },
      { path: 'attributes.nhom_huong', message: expect.stringContaining('Hương biển') },
    ])
  })

  it('key không có trong schema, hoặc thuộc cấp khác, thì bị từ chối', async () => {
    const { request, token } = await ownerSession()

    const res = await validate(request, token, 'footwear', {
      level: 'product',
      attributes: { gioi_tinh: 'Nam', he_size: 'EU', ma_mau: 'SRPD55K1', size: '40' },
    })

    expect(res.status).toBe(400)
    expect(res.body.error.fields.map((f: { path: string }) => f.path)).toEqual(['attributes.ma_mau', 'attributes.size'])
  })
})

type Definition = { key: string; type: string; options?: string[]; required: boolean }

async function watchSchema(request: Request, token: string) {
  const res = await request.get('/api/admin/attribute-schemas/watch').set(bearer(token))
  expect(res.status).toBe(200)
  return res.body.attributes as Definition[]
}

function putSchema(request: Request, token: string, attributes: unknown[]) {
  return request.put('/api/admin/attribute-schemas/watch').set(bearer(token)).send({ attributes })
}

const WATER_RESISTANCE = {
  key: 'chong_nuoc',
  label: 'Chống nước',
  type: 'number',
  unit: 'm',
  required: false,
  level: 'product',
  filterable: true,
}

describe('sửa schema thuộc tính', () => {
  it('thêm thuộc tính thì website thấy ngay, bộ kiểm dùng schema mới và audit có schema trước và sau', async () => {
    const { request, token } = await ownerSession()
    const before = await watchSchema(request, token)

    const res = await putSchema(request, token, [...before, WATER_RESISTANCE])
    const published = await request.get('/api/attribute-schemas/watch')
    const checked = await validate(request, token, 'watch', {
      level: 'product',
      attributes: { gioi_tinh: 'Nam', kich_thuoc_mat: 40, loai_bo_may: 'Automatic', chong_nuoc: 'nhiều' },
    })
    const audit = await request.get('/api/admin/audit').query({ entityType: 'attribute_schema' }).set(bearer(token))

    expect(res.status).toBe(200)
    expect(res.body.attributes).toEqual([...before, WATER_RESISTANCE])
    expect(published.body.attributes).toEqual([...before, WATER_RESISTANCE])
    expect(checked.body.error.fields).toEqual([{ path: 'attributes.chong_nuoc', message: expect.any(String) }])
    expect(audit.body.items).toEqual([
      expect.objectContaining({
        action: 'catalog.attribute_schema.update',
        entityId: 'watch',
        before: { attributes: before },
        after: { attributes: [...before, WATER_RESISTANCE] },
      }),
    ])
  })

  it('đổi thứ tự, xóa thuộc tính và bớt giá trị enum đều lưu được khi chưa có sản phẩm vi phạm', async () => {
    const { request, token } = await ownerSession()
    const [gender, ...rest] = await watchSchema(request, token)
    const movement = rest.find((a) => a.key === 'loai_bo_may')!

    const res = await putSchema(request, token, [{ ...movement, options: ['Quartz', 'Automatic'] }, gender])

    expect(res.status).toBe(200)
    expect(res.body.attributes.map((a: Definition) => a.key)).toEqual(['loai_bo_may', 'gioi_tinh'])
    expect(res.body.attributes[0].options).toEqual(['Quartz', 'Automatic'])
  })

  it('lưu lại đúng schema hiện tại thì không ghi audit', async () => {
    const { request, token } = await ownerSession()
    const before = await watchSchema(request, token)

    const res = await putSchema(request, token, before)
    const audit = await request.get('/api/admin/audit').query({ entityType: 'attribute_schema' }).set(bearer(token))

    expect(res.status).toBe(200)
    expect(audit.body.items).toEqual([])
  })

  it('key trùng, enum không có giá trị hay bỏ giới tính thì bị từ chối kèm lỗi theo trường', async () => {
    const { request, token } = await ownerSession()
    const [gender, ...rest] = await watchSchema(request, token)

    const duplicate = await putSchema(request, token, [gender, ...rest, { ...WATER_RESISTANCE, key: 'chat_lieu' }])
    const noOptions = await putSchema(request, token, [gender, { ...WATER_RESISTANCE, type: 'enum', options: [] }])
    const noGender = await putSchema(request, token, rest)
    const genderNotFilterable = await putSchema(request, token, [{ ...gender, filterable: false }, ...rest])

    expect(duplicate.status).toBe(400)
    expect(duplicate.body.error.fields).toEqual([
      { path: `attributes.${rest.length + 1}.key`, message: 'Key bị trùng' },
    ])
    expect(noOptions.status).toBe(400)
    expect(noOptions.body.error.fields).toEqual([{ path: 'attributes.1.options', message: expect.any(String) }])
    for (const res of [noGender, genderNotFilterable]) {
      expect(res.status).toBe(400)
      expect(res.body.error.fields).toEqual([{ path: 'attributes', message: expect.stringContaining('gioi_tinh') }])
    }
    expect(await watchSchema(request, token)).toEqual([gender, ...rest])
  })
})

describe('quyền', () => {
  it('thiếu catalog.edit thì không xem, sửa hay dùng bộ kiểm schema được', async () => {
    const { request, token: ownerToken } = await ownerSession()
    const before = await watchSchema(request, ownerToken)
    const { accessToken: token } = await createStaff(request, ownerToken, ['accountant'])

    const attempts = await Promise.all([
      request.get('/api/admin/attribute-schemas').set(bearer(token)),
      request.get('/api/admin/attribute-schemas/watch').set(bearer(token)),
      putSchema(request, token, [...before, WATER_RESISTANCE]),
      validate(request, token, 'watch', { level: 'product', attributes: {} }),
    ])

    for (const res of attempts) {
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    }
    expect(await watchSchema(request, ownerToken)).toEqual(before)
  })

  it('nhân viên bán hàng có catalog.edit thì xem được đủ năm schema và sửa được', async () => {
    const { request, token: ownerToken } = await ownerSession()
    const before = await watchSchema(request, ownerToken)
    const { accessToken: token } = await createStaff(request, ownerToken, ['sales'])

    const list = await request.get('/api/admin/attribute-schemas').set(bearer(token))
    const res = await putSchema(request, token, [...before, WATER_RESISTANCE])

    expect(list.status).toBe(200)
    expect(list.body.items.map((s: { productType: string }) => s.productType)).toEqual([
      'footwear',
      'apparel',
      'watch',
      'bag',
      'fragrance',
    ])
    expect(res.status).toBe(200)
  })

  it('chưa đăng nhập thì 401', async () => {
    const { request } = await createTestApp()

    const res = await request.get('/api/admin/attribute-schemas')

    expect(res.status).toBe(401)
  })
})
