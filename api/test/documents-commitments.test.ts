import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

async function post(request: Request, token: string, path: string, body: Record<string, unknown>) {
  const res = await request.post(path).set(bearer(token)).send(body)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

/** Owner đã đăng nhập, có sẵn sản phẩm nháp Air Max 90 (slug `air-max-90`). */
async function sneaker() {
  const app = await appWithOwner()
  const { accessToken: token } = await login(app.request, OWNER.email, OWNER.password)
  const brand = await post(app.request, token, '/api/admin/brands', { name: 'Nike', slug: 'nike' })
  const category = await post(app.request, token, '/api/admin/categories', {
    name: 'Sneaker',
    slug: 'sneaker',
    productType: 'footwear',
  })
  const product = await post(app.request, token, '/api/admin/products', {
    brandId: brand.id,
    categoryId: category.id,
    name: 'Air Max 90',
    slug: 'air-max-90',
    attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
  })
  return { ...app, token, brand, category, product }
}

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n')

function uploadDocument(request: Request, token: string, productId: string, file = PDF, filename = 'hoa-don-nhap.pdf') {
  return request.post(`/api/admin/products/${productId}/documents`).set(bearer(token)).attach('file', file, filename)
}

async function documentOf(request: Request, token: string, productId: string, filename = 'hoa-don-nhap.pdf') {
  const res = await uploadDocument(request, token, productId, PDF, filename)
  expect(res.status).toBe(201)
  return res.body as { id: string }
}

function documentUrl(request: Request, token: string, productId: string, documentId: string) {
  return request.post(`/api/admin/products/${productId}/documents/${documentId}/url`).set(bearer(token))
}

function auditOf(request: Request, token: string, entityType: string) {
  return request
    .get('/api/admin/audit')
    .query({ entityType })
    .set(bearer(token))
    .then(
      (res) =>
        res.body.items as {
          action: string
          entityId: string
          actor: { id: string }
          before: unknown
          after: unknown
          createdAt: string
        }[],
    )
}

describe('chứng từ private', () => {
  it('chứng từ lên bucket private, không có URL công khai nào trong response', async () => {
    const { request, token, product, storage } = await sneaker()

    const res = await uploadDocument(request, token, product.id)

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.any(String),
      fileName: 'hoa-don-nhap.pdf',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
      createdAt: expect.any(String),
    })
    const stored = [...storage.objects.entries()]
    expect(stored).toHaveLength(1)
    expect(stored[0]![0]).toMatch(/^private\//)
    expect(stored[0]![1]).toMatchObject({ contentType: 'application/pdf', body: PDF })

    const list = await request.get(`/api/admin/products/${product.id}/documents`).set(bearer(token))
    expect(list.status).toBe(200)
    expect(list.body.items).toEqual([res.body])
  })

  it('nhận ảnh jpeg, png, webp; file giả mạo đuôi bị từ chối theo nội dung thật', async () => {
    const { request, token, product, storage } = await sneaker()
    const image = (format: 'jpeg' | 'png' | 'webp') =>
      sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } })
        .toFormat(format)
        .toBuffer()

    const accepted = [
      await uploadDocument(request, token, product.id, await image('jpeg'), 'scan.jpg'),
      await uploadDocument(request, token, product.id, await image('png'), 'scan.png'),
      await uploadDocument(request, token, product.id, await image('webp'), 'scan'),
    ]
    expect(accepted.map((r) => [r.status, r.body.contentType])).toEqual([
      [201, 'image/jpeg'],
      [201, 'image/png'],
      [201, 'image/webp'],
    ])

    const fake = await uploadDocument(request, token, product.id, Buffer.from('<html>không phải pdf</html>'), 'x.pdf')
    expect(fake.status).toBe(400)
    expect(fake.body.error.fields).toEqual([
      { path: 'file', message: 'Chứng từ phải là file pdf, jpeg, png hoặc webp' },
    ])
    expect(storage.objects.size).toBe(3)
  })

  it('chứng từ quá dung lượng bị từ chối', async () => {
    const { request, token, product, storage } = await sneaker()
    const big = Buffer.concat([PDF, Buffer.alloc(20 * 1024 * 1024)])

    const res = await uploadDocument(request, token, product.id, big)

    expect(res.status).toBe(413)
    expect(res.body.error.fields).toEqual([{ path: 'file', message: 'Chứng từ vượt quá 20 MB' }])
    expect(storage.objects.size).toBe(0)
  })

  it('thiếu document.view thì không xem, không tải lên và không lấy được URL ký của chứng từ', async () => {
    const { request, token, product } = await sneaker()
    const document = await documentOf(request, token, product.id)
    const sales = await createStaff(request, token, ['sales'])

    const responses = [
      await request.get(`/api/admin/products/${product.id}/documents`).set(bearer(sales.accessToken)),
      await uploadDocument(request, sales.accessToken, product.id),
      await documentUrl(request, sales.accessToken, product.id, document.id),
      await request.delete(`/api/admin/products/${product.id}/documents/${document.id}`).set(bearer(sales.accessToken)),
    ]

    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403])
    expect((await auditOf(request, token, 'product_document')).map((e) => e.action)).toEqual(['document.upload'])
  })

  it('người có document.view lấy được URL ký có hạn, mỗi lần lấy đều ghi audit ai mở chứng từ nào', async () => {
    const { request, token, product } = await sneaker()
    const document = await documentOf(request, token, product.id)
    const accountant = await createStaff(request, token, ['accountant'])

    const first = await documentUrl(request, accountant.accessToken, product.id, document.id)
    const second = await documentUrl(request, accountant.accessToken, product.id, document.id)

    for (const res of [first, second]) {
      expect(res.status).toBe(200)
      expect(res.body.url).toMatch(/^memory:\/\/private\/products\/.+\?expires=300$/)
      expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now())
    }
    const views = (await auditOf(request, token, 'product_document')).filter((e) => e.action === 'document.view')
    expect(views).toHaveLength(2)
    for (const view of views) {
      expect(view).toMatchObject({
        entityId: document.id,
        actor: { id: accountant.id },
        after: { productId: product.id, fileName: 'hoa-don-nhap.pdf' },
      })
    }
  })

  it('chứng từ của sản phẩm khác coi như không có', async () => {
    const { request, token, product, brand, category } = await sneaker()
    const other = await post(request, token, '/api/admin/products', {
      brandId: brand.id,
      categoryId: category.id,
      name: 'Air Force 1',
      slug: 'air-force-1',
      attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
    })
    const document = await documentOf(request, token, other.id)

    const res = await documentUrl(request, token, product.id, document.id)

    expect(res.status).toBe(404)
  })
})

type CommitmentType = { id: string; name: string; kind: 'warranty' | 'other' }

async function commitmentTypes(request: Request, token: string) {
  const res = await request.get('/api/admin/commitment-types').set(bearer(token))
  expect(res.status).toBe(200)
  return res.body.items as CommitmentType[]
}

async function typeNamed(request: Request, token: string, name: string) {
  const found = (await commitmentTypes(request, token)).find((t) => t.name === name)
  expect(found).toBeDefined()
  return found!
}

describe('loại cam kết', () => {
  it('danh sách đóng có sẵn các loại seed', async () => {
    const { request, token } = await sneaker()

    expect(await commitmentTypes(request, token)).toEqual([
      { id: expect.any(String), name: 'Bảo hành chính hãng', kind: 'warranty' },
      { id: expect.any(String), name: 'Bảo hành quốc tế', kind: 'warranty' },
      { id: expect.any(String), name: 'Có hóa đơn nhập khẩu', kind: 'other' },
    ])
  })

  it('owner thêm và sửa loại cam kết, mỗi thao tác ghi audit; trùng tên bị từ chối', async () => {
    const { request, token } = await sneaker()

    const created = await request
      .post('/api/admin/commitment-types')
      .set(bearer(token))
      .send({ name: 'Có giấy chứng nhận chính hãng', kind: 'other' })
    expect(created.status).toBe(201)
    const updated = await request
      .put(`/api/admin/commitment-types/${created.body.id}`)
      .set(bearer(token))
      .send({ name: 'Có giấy chứng nhận của hãng', kind: 'other' })
    expect(updated.body).toEqual({ id: created.body.id, name: 'Có giấy chứng nhận của hãng', kind: 'other' })
    const duplicate = await request
      .post('/api/admin/commitment-types')
      .set(bearer(token))
      .send({ name: 'Bảo hành chính hãng', kind: 'warranty' })
    expect(duplicate.status).toBe(409)

    const audit = await auditOf(request, token, 'commitment_type')
    expect(audit.map((e) => [e.action, e.after])).toEqual([
      ['commitment_type.update', { name: 'Có giấy chứng nhận của hãng', kind: 'other' }],
      ['commitment_type.create', { name: 'Có giấy chứng nhận chính hãng', kind: 'other' }],
    ])
  })

  it('có catalog.edit nhưng không có commitment.edit thì không thêm, sửa được loại cam kết', async () => {
    const { request, token } = await sneaker()
    const warehouse = await createStaff(request, token, ['warehouse'])
    const warranty = await typeNamed(request, token, 'Bảo hành chính hãng')

    const responses = [
      await request
        .post('/api/admin/commitment-types')
        .set(bearer(warehouse.accessToken))
        .send({ name: 'Bảo hành trọn đời', kind: 'warranty' }),
      await request
        .put(`/api/admin/commitment-types/${warranty.id}`)
        .set(bearer(warehouse.accessToken))
        .send({ name: 'Bảo hành trọn đời', kind: 'warranty' }),
    ]

    expect(responses.map((r) => r.status)).toEqual([403, 403])
    expect(await commitmentTypes(request, warehouse.accessToken)).toHaveLength(3)
  })
})

function createCommitment(request: Request, token: string, productId: string, body: Record<string, unknown>) {
  return request.post(`/api/admin/products/${productId}/commitments`).set(bearer(token)).send(body)
}

/** Sản phẩm có hóa đơn nhập và cam kết "Bảo hành chính hãng" dựa trên hóa đơn đó. */
async function sneakerWithWarranty() {
  const app = await sneaker()
  const invoice = await documentOf(app.request, app.token, app.product.id)
  const warranty = await typeNamed(app.request, app.token, 'Bảo hành chính hãng')
  const res = await createCommitment(app.request, app.token, app.product.id, {
    typeId: warranty.id,
    statement: 'Bảo hành chính hãng Nike 12 tháng',
    documentIds: [invoice.id],
  })
  expect(res.status).toBe(201)
  return { ...app, invoice, warranty, commitment: res.body as { id: string } }
}

/** Xuất bản qua API: thêm một biến thể có giá và một ảnh cho đủ điều kiện. */
async function publish(app: { request: Request; token: string }, id: string) {
  await post(app.request, app.token, `/api/admin/products/${id}/variants`, {
    sku: 'AM90-DEN-40',
    attributes: { mau: 'Đen', size: '40' },
    price: 3_500_000,
  })
  const photo = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
    .jpeg()
    .toBuffer()
  const image = await app.request
    .post(`/api/admin/products/${id}/images`)
    .set(bearer(app.token))
    .attach('file', photo, 'anh.jpg')
  expect(image.status).toBe(201)
  const res = await app.request
    .put(`/api/admin/products/${id}/status`)
    .set(bearer(app.token))
    .send({ status: 'published' })
  expect(res.status).toBe(200)
}

describe('cam kết có bằng chứng', () => {
  it('owner ghi cam kết tham chiếu chứng từ của sản phẩm; tạo, sửa, gỡ đều ghi audit', async () => {
    const { request, token, product, invoice, warranty, commitment } = await sneakerWithWarranty()
    const certificate = await documentOf(request, token, product.id, 'giay-chung-nhan.pdf')

    const list = await request.get(`/api/admin/products/${product.id}/commitments`).set(bearer(token))
    expect(list.body.items).toEqual([
      {
        id: commitment.id,
        typeId: warranty.id,
        typeName: 'Bảo hành chính hãng',
        kind: 'warranty',
        statement: 'Bảo hành chính hãng Nike 12 tháng',
        documentIds: [invoice.id],
      },
    ])
    const updated = await request
      .put(`/api/admin/products/${product.id}/commitments/${commitment.id}`)
      .set(bearer(token))
      .send({ typeId: warranty.id, statement: 'Bảo hành chính hãng Nike 24 tháng', documentIds: [certificate.id] })
    expect(updated.status).toBe(200)
    expect(updated.body).toMatchObject({
      statement: 'Bảo hành chính hãng Nike 24 tháng',
      documentIds: [certificate.id],
    })
    const removed = await request
      .delete(`/api/admin/products/${product.id}/commitments/${commitment.id}`)
      .set(bearer(token))
    expect(removed.status).toBe(204)

    const audit = await auditOf(request, token, 'product_commitment')
    expect(audit.map((e) => [e.action, e.before, e.after])).toEqual([
      [
        'commitment.delete',
        {
          productId: product.id,
          typeId: warranty.id,
          statement: 'Bảo hành chính hãng Nike 24 tháng',
          documentIds: [certificate.id],
        },
        null,
      ],
      [
        'commitment.update',
        {
          productId: product.id,
          typeId: warranty.id,
          statement: 'Bảo hành chính hãng Nike 12 tháng',
          documentIds: [invoice.id],
        },
        {
          productId: product.id,
          typeId: warranty.id,
          statement: 'Bảo hành chính hãng Nike 24 tháng',
          documentIds: [certificate.id],
        },
      ],
      [
        'commitment.create',
        null,
        {
          productId: product.id,
          typeId: warranty.id,
          statement: 'Bảo hành chính hãng Nike 12 tháng',
          documentIds: [invoice.id],
        },
      ],
    ])
  })

  it('cam kết không có chứng từ bị từ chối', async () => {
    const { request, token, product } = await sneaker()
    const warranty = await typeNamed(request, token, 'Bảo hành chính hãng')

    const res = await createCommitment(request, token, product.id, {
      typeId: warranty.id,
      statement: 'Bảo hành chính hãng 12 tháng',
      documentIds: [],
    })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([
      { path: 'documentIds', message: 'Cam kết cần dựa trên ít nhất một chứng từ' },
    ])
  })

  it('cam kết dựa trên chứng từ của sản phẩm khác bị từ chối', async () => {
    const { request, token, product, brand, category } = await sneaker()
    const other = await post(request, token, '/api/admin/products', {
      brandId: brand.id,
      categoryId: category.id,
      name: 'Air Force 1',
      slug: 'air-force-1',
      attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
    })
    const foreign = await documentOf(request, token, other.id)
    const warranty = await typeNamed(request, token, 'Bảo hành chính hãng')

    const res = await createCommitment(request, token, product.id, {
      typeId: warranty.id,
      statement: 'Bảo hành chính hãng 12 tháng',
      documentIds: [foreign.id],
    })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([
      { path: 'documentIds.0', message: 'Chỉ dựa được trên chứng từ của chính sản phẩm này' },
    ])
  })

  it('cam kết với loại không có trong danh sách bị từ chối', async () => {
    const { request, token, product } = await sneaker()
    const invoice = await documentOf(request, token, product.id)

    const res = await createCommitment(request, token, product.id, {
      typeId: '00000000-0000-4000-8000-000000000000',
      statement: 'Bảo hành trọn đời',
      documentIds: [invoice.id],
    })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([{ path: 'typeId', message: 'Loại cam kết không có trong danh sách' }])
  })

  it('mỗi loại cam kết chỉ ghi một lần trên một sản phẩm', async () => {
    const { request, token, product, invoice, warranty } = await sneakerWithWarranty()

    const res = await createCommitment(request, token, product.id, {
      typeId: warranty.id,
      statement: 'Bảo hành thêm',
      documentIds: [invoice.id],
    })

    expect(res.status).toBe(409)
    expect(res.body.error.fields?.[0]?.path).toBe('typeId')
  })

  it('có catalog.edit nhưng không có commitment.edit thì bị 403 khi tạo, sửa, gỡ cam kết', async () => {
    const { request, token, product, invoice, warranty, commitment } = await sneakerWithWarranty()
    const warehouse = await createStaff(request, token, ['warehouse', 'sales', 'accountant'])
    const body = { typeId: warranty.id, statement: 'Bảo hành 36 tháng', documentIds: [invoice.id] }
    const path = `/api/admin/products/${product.id}/commitments`

    const responses = [
      await createCommitment(request, warehouse.accessToken, product.id, body),
      await request.put(`${path}/${commitment.id}`).set(bearer(warehouse.accessToken)).send(body),
      await request.delete(`${path}/${commitment.id}`).set(bearer(warehouse.accessToken)),
    ]

    expect(responses.map((r) => r.status)).toEqual([403, 403, 403])
    const list = await request.get(path).set(bearer(warehouse.accessToken))
    expect(list.body.items.map((c: { statement: string }) => c.statement)).toEqual([
      'Bảo hành chính hãng Nike 12 tháng',
    ])
  })

  it('xóa chứng từ đang được cam kết tham chiếu bị từ chối kèm danh sách cam kết; gỡ cam kết rồi thì xóa được', async () => {
    const { request, token, product, invoice, commitment, storage } = await sneakerWithWarranty()
    const path = `/api/admin/products/${product.id}/documents/${invoice.id}`

    const refused = await request.delete(path).set(bearer(token))

    expect(refused.status).toBe(409)
    expect(refused.body.error.fields).toEqual([
      { path: `commitments.${commitment.id}`, message: 'Bảo hành chính hãng: Bảo hành chính hãng Nike 12 tháng' },
    ])
    expect(storage.objects.size).toBe(1)

    await request.delete(`/api/admin/products/${product.id}/commitments/${commitment.id}`).set(bearer(token))
    expect((await request.delete(path).set(bearer(token))).status).toBe(204)
    expect(storage.objects.size).toBe(0)
  })
})

describe('cam kết trên API công khai', () => {
  it('chi tiết sản phẩm trả loại và nội dung cam kết, không có chứng từ hay URL của chứng từ', async () => {
    const app = await sneakerWithWarranty()
    await publish(app, app.product.id)

    const res = await app.request.get('/api/products/air-max-90')

    expect(res.status).toBe(200)
    expect(res.body.commitments).toEqual([
      { type: 'Bảo hành chính hãng', kind: 'warranty', statement: 'Bảo hành chính hãng Nike 12 tháng' },
    ])
    const raw = JSON.stringify(res.body)
    expect(raw).not.toContain(app.invoice.id)
    expect(raw).not.toContain('hoa-don-nhap')
    expect(raw).not.toContain('memory://private')
  })

  it('sản phẩm không có cam kết bảo hành thì API công khai không trả về bảo hành nào', async () => {
    const app = await sneaker()
    const invoice = await documentOf(app.request, app.token, app.product.id)
    const imported = await typeNamed(app.request, app.token, 'Có hóa đơn nhập khẩu')
    await createCommitment(app.request, app.token, app.product.id, {
      typeId: imported.id,
      statement: 'Hàng nhập khẩu có hóa đơn',
      documentIds: [invoice.id],
    })
    await publish(app, app.product.id)

    const res = await app.request.get('/api/products/air-max-90')

    expect(res.status).toBe(200)
    expect(res.body.commitments).toEqual([
      { type: 'Có hóa đơn nhập khẩu', kind: 'other', statement: 'Hàng nhập khẩu có hóa đơn' },
    ])
    expect(JSON.stringify(res.body.commitments)).not.toMatch(/bảo hành|warranty/i)
  })

  it('sản phẩm nháp không có trên API công khai', async () => {
    const { request } = await sneakerWithWarranty()

    const res = await request.get('/api/products/air-max-90')

    expect(res.status).toBe(404)
  })
})
