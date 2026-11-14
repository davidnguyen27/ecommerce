import { describe, expect, it } from 'vitest'
import { shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const DAY = 24 * 60 * 60_000
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString()

type Shop = Awaited<ReturnType<typeof shop>>

/** Cửa hàng có sản phẩm Air Max đã xuất bản (AM-40, AM-41), và hàm mở/sửa/đóng đợt bằng tài khoản owner. */
async function campaigns() {
  const app = await shop()
  const { request, token, product, v40, v41 } = app
  const base = (overrides: Record<string, unknown> = {}) => ({
    productId: product.id,
    depositPercent: 30,
    deliveryFrom: '2026-12-10',
    deliveryTo: '2026-12-20',
    closesAt: inDays(14),
    variants: [
      { variantId: v40.id, allocation: 10 },
      { variantId: v41.id, allocation: 5 },
    ],
    ...overrides,
  })
  const create = (overrides: Record<string, unknown> = {}, as = token) =>
    request.post('/api/admin/preorder-campaigns').set(bearer(as)).send(base(overrides))
  const update = (id: string, body: Record<string, unknown>, as = token) =>
    request.patch(`/api/admin/preorder-campaigns/${id}`).set(bearer(as)).send(body)
  const close = (id: string, as = token) => request.post(`/api/admin/preorder-campaigns/${id}/close`).set(bearer(as))
  const get = (id: string, as = token) => request.get(`/api/admin/preorder-campaigns/${id}`).set(bearer(as))
  const audits = async () => {
    const res = await request.get('/api/admin/audit').query({ entityType: 'preorder_campaign' }).set(bearer(token))
    expect(res.status).toBe(200)
    return res.body.items as { action: string; before: unknown; after: unknown }[]
  }
  /**
   * Một đơn chưa hủy thuộc đợt, 1 đôi AM-40. Ticket 04 mới có đường đặt trước qua HTTP, nên test lấy một đơn đặt mua
   * thường rồi gắn đợt bằng `prisma`.
   */
  const orderIn = async (campaignId: string) => {
    const res = await app.checkout()
    expect(res.status).toBe(201)
    await app.prisma.order.update({ where: { code: res.body.code }, data: { preorderCampaignId: campaignId } })
    return res.body.code as number
  }
  return { ...app, base, create, update, close, get, audits, orderIn }
}

const opened = async (app: Shop & Awaited<ReturnType<typeof campaigns>>, overrides?: Record<string, unknown>) => {
  const res = await app.create(overrides)
  expect(res.status).toBe(201)
  return res.body as { id: string; variants: { sku: string; allocation: number; used: number }[] }
}

describe('mở đợt đặt trước', () => {
  it('mở đợt với biến thể và suất; mặc định 7 ngày trả phần còn lại, chưa đặt nhập; ghi audit', async () => {
    const app = await campaigns()

    const res = await app.create({ supplyNote: 'Hẹn nhà cung cấp tuần sau' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      product: { id: app.product.id, name: 'Air Max', status: 'published' },
      depositPercent: 30,
      deliveryFrom: '2026-12-10',
      deliveryTo: '2026-12-20',
      remainderDays: 7,
      supplyStatus: 'not_ordered',
      supplyNote: 'Hẹn nhà cung cấp tuần sau',
      closedAt: null,
      isOpen: true,
      createdBy: { email: 'chu@example.com' },
    })
    expect(res.body.variants).toEqual([
      expect.objectContaining({ sku: 'AM-40', allocation: 10, used: 0, status: 'active' }),
      expect.objectContaining({ sku: 'AM-41', allocation: 5, used: 0 }),
    ])
    expect(await app.audits()).toEqual([
      expect.objectContaining({
        action: 'preorder.campaign.create',
        after: expect.objectContaining({ depositPercent: 30 }),
      }),
    ])
  })

  it('sản phẩm đã có một đợt đang mở thì 409; đợt cũ quá hạn đóng hoặc đã đóng tay thì mở được đợt mới', async () => {
    const app = await campaigns()
    const first = await opened(app)

    const duplicate = await app.create()
    expect(duplicate.status).toBe(409)

    // Dựng một đợt đã quá hạn đóng: API không cho đặt hạn ở quá khứ.
    await app.prisma.preorderCampaign.update({
      where: { id: first.id },
      data: { closesAt: new Date(Date.now() - 1000) },
    })
    const second = await opened(app)
    expect((await app.close(second.id)).status).toBe(200)
    expect((await app.create()).status).toBe(201)
  })

  it('hai người mở đợt cho cùng sản phẩm cùng lúc: đúng một đợt được mở', async () => {
    const app = await campaigns()

    const results = await Promise.all([app.create(), app.create(), app.create()])

    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409])
  })

  it('từ chối dữ liệu sai: cọc ngoài 10–100, ngày giao ngược, hạn đóng ở quá khứ, biến thể trùng, lạ hay ngừng bán', async () => {
    const app = await campaigns()
    const { v40, editVariant } = app
    expect((await editVariant(app.v41, 'AM-41', '41', { status: 'discontinued' })).status).toBe(200)
    const field = async (overrides: Record<string, unknown>) => {
      const res = await app.create(overrides)
      expect(res.status).toBe(400)
      return (res.body.error.fields as { path: string }[]).map((f) => f.path)
    }

    expect(await field({ depositPercent: 5 })).toEqual(['depositPercent'])
    expect(await field({ depositPercent: 101 })).toEqual(['depositPercent'])
    expect(await field({ deliveryFrom: '2026-12-21' })).toEqual(['deliveryTo'])
    expect(await field({ closesAt: inDays(-1) })).toEqual(['closesAt'])
    expect(await field({ variants: [] })).toEqual(['variants'])
    expect(
      await field({
        variants: [
          { variantId: v40.id, allocation: 1 },
          { variantId: v40.id, allocation: 2 },
        ],
      }),
    ).toEqual(['variants.1.variantId'])
    expect(await field({ variants: [{ variantId: v40.id, allocation: 0 }] })).toEqual(['variants.0.allocation'])
    expect(
      await field({
        variants: [
          { variantId: v40.id, allocation: 1 },
          { variantId: '00000000-0000-4000-8000-000000000000', allocation: 1 },
        ],
      }),
    ).toEqual(['variants.1.variantId'])
    expect(await field({ variants: [{ variantId: app.v41.id, allocation: 1 }] })).toEqual(['variants.0.variantId'])
    expect(await app.audits()).toEqual([])
  })

  it('biến thể của sản phẩm khác thì 400; sản phẩm chưa xuất bản hoặc đã lưu trữ thì 409', async () => {
    const app = await campaigns()
    const { request, token, brand, category, product } = app
    const other = await request
      .post('/api/admin/products')
      .set(bearer(token))
      .send({
        brandId: brand.id,
        categoryId: category.id,
        name: 'Pegasus',
        slug: 'pegasus',
        attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
      })
    expect(other.status).toBe(201)
    const otherVariant = await request
      .post(`/api/admin/products/${other.body.id}/variants`)
      .set(bearer(token))
      .send({ sku: 'PG-40', attributes: { mau: 'Đen', size: '40' }, price: 1_500_000 })
    expect(otherVariant.status).toBe(201)

    const foreign = await app.create({ variants: [{ variantId: otherVariant.body.id, allocation: 1 }] })
    expect(foreign.status).toBe(400)
    const draft = await app.create({
      productId: other.body.id,
      variants: [{ variantId: otherVariant.body.id, allocation: 1 }],
    })
    expect(draft.status).toBe(409)
    const archive = await request
      .put(`/api/admin/products/${product.id}/status`)
      .set(bearer(token))
      .send({ status: 'archived' })
    expect(archive.status).toBe(200)
    expect((await app.create()).status).toBe(409)
  })
})

describe('sửa và đóng đợt', () => {
  it('sửa thời gian giao, hạn đóng, suất, thêm biến thể, trạng thái nhập hàng; audit chỉ ghi các trường đổi', async () => {
    const app = await campaigns()
    const campaign = await opened(app, { variants: [{ variantId: app.v40.id, allocation: 10 }] })
    const closesAt = inDays(30)

    const res = await app.update(campaign.id, {
      deliveryTo: '2026-12-31',
      closesAt,
      supplyStatus: 'ordered',
      depositPercent: 30,
      variants: [
        { variantId: app.v40.id, allocation: 12 },
        { variantId: app.v41.id, allocation: 3 },
      ],
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      deliveryFrom: '2026-12-10',
      deliveryTo: '2026-12-31',
      closesAt: new Date(closesAt).toISOString(),
      supplyStatus: 'ordered',
      depositPercent: 30,
    })
    expect(res.body.variants).toEqual([
      expect.objectContaining({ sku: 'AM-40', allocation: 12 }),
      expect.objectContaining({ sku: 'AM-41', allocation: 3 }),
    ])
    const [update] = await app.audits()
    expect(update).toMatchObject({ action: 'preorder.campaign.update' })
    expect(Object.keys(update!.after as object).sort()).toEqual(['closesAt', 'deliveryTo', 'supplyStatus', 'variants'])
  })

  it('gửi lại đúng giá trị hiện tại thì không ghi gì và trả đợt như cũ', async () => {
    const app = await campaigns()
    const campaign = await opened(app)

    const res = await app.update(campaign.id, {
      depositPercent: 30,
      deliveryFrom: '2026-12-10',
      variants: app.base().variants,
    })

    expect(res.status).toBe(200)
    expect(res.body.id).toBe(campaign.id)
    expect((await app.audits()).map((a) => a.action)).toEqual(['preorder.campaign.create'])
  })

  it('đợt đã có đơn: không đổi mức cọc hay số ngày, không giảm suất dưới số đã đặt, không bỏ biến thể đã có đơn', async () => {
    const app = await campaigns()
    const campaign = await opened(app)
    await app.orderIn(campaign.id)
    await app.orderIn(campaign.id)
    expect((await app.get(campaign.id)).body.variants[0]).toMatchObject({ sku: 'AM-40', used: 2 })

    expect((await app.update(campaign.id, { depositPercent: 50 })).status).toBe(409)
    expect((await app.update(campaign.id, { remainderDays: 3 })).status).toBe(409)
    const lower = await app.update(campaign.id, { variants: [{ variantId: app.v40.id, allocation: 1 }] })
    expect(lower.status).toBe(409)
    expect(lower.body.error.fields).toEqual([
      { path: 'variants.0.allocation', message: 'Đã đặt 2, suất không thấp hơn được' },
    ])
    const dropped = await app.update(campaign.id, { variants: [{ variantId: app.v41.id, allocation: 5 }] })
    expect(dropped.status).toBe(409)
    expect(dropped.body.error.fields).toEqual([
      { path: 'variants', message: 'AM-40 đã có đơn, không bỏ khỏi đợt được' },
    ])

    // Suất bằng đúng số đã đặt, và bỏ biến thể chưa có đơn, vẫn được.
    const ok = await app.update(campaign.id, { variants: [{ variantId: app.v40.id, allocation: 2 }] })
    expect(ok.status).toBe(200)
    expect(ok.body.variants).toEqual([expect.objectContaining({ sku: 'AM-40', allocation: 2, used: 2 })])
    expect((await app.audits()).map((a) => a.action)).toEqual(['preorder.campaign.update', 'preorder.campaign.create'])
  })

  it('đơn đã hủy không tính vào số đã dùng và không khóa mức cọc', async () => {
    const app = await campaigns()
    const campaign = await opened(app)
    const code = await app.orderIn(campaign.id)
    await app.prisma.order.update({
      where: { code },
      data: { status: 'cancelled', cancelReason: 'staff', cancelledAt: new Date(), reservedUntil: null },
    })

    expect((await app.get(campaign.id)).body.variants[0]).toMatchObject({ sku: 'AM-40', used: 0 })
    expect((await app.update(campaign.id, { depositPercent: 50 })).status).toBe(200)
  })

  it('đóng tay: đợt thôi mở, không mở lại bằng cách đổi hạn đóng; đóng lần nữa không ghi gì', async () => {
    const app = await campaigns()
    const campaign = await opened(app)

    const closed = await app.close(campaign.id)
    expect(closed.status).toBe(200)
    expect(closed.body).toMatchObject({ isOpen: false, closedAt: expect.any(String) })

    expect((await app.update(campaign.id, { closesAt: inDays(60) })).status).toBe(409)
    expect((await app.close(campaign.id)).body.closedAt).toBe(closed.body.closedAt)
    // Đợt đã đóng vẫn cập nhật được tiến độ nhập (hàng của các đơn đã cọc vẫn đang về).
    expect((await app.update(campaign.id, { supplyStatus: 'in_transit' })).status).toBe(200)
    expect((await app.audits()).map((a) => a.action)).toEqual([
      'preorder.campaign.update',
      'preorder.campaign.close',
      'preorder.campaign.create',
    ])
  })

  it('đổi hạn đóng sang quá khứ thì 400; đợt lạ thì 404', async () => {
    const app = await campaigns()
    const campaign = await opened(app)

    expect((await app.update(campaign.id, { closesAt: inDays(-1) })).status).toBe(400)
    const missing = '00000000-0000-4000-8000-000000000000'
    expect((await app.get(missing)).status).toBe(404)
    expect((await app.update(missing, { supplyNote: 'x' })).status).toBe(404)
    expect((await app.close(missing)).status).toBe(404)
  })
})

describe('danh sách đợt', () => {
  it('lọc đang mở, đã đóng, theo sản phẩm; kèm tổng suất và số đã dùng', async () => {
    const app = await campaigns()
    const old = await opened(app)
    await app.close(old.id)
    const current = await opened(app)
    await app.orderIn(current.id)
    const list = (query: Record<string, string>) =>
      app.request.get('/api/admin/preorder-campaigns').query(query).set(bearer(app.token))

    const all = await list({})
    expect(all.body).toMatchObject({ total: 2, page: 1 })
    expect(all.body.items.map((c: { id: string }) => c.id)).toEqual([current.id, old.id])
    expect(all.body.items[0]).toMatchObject({ variantCount: 2, totalAllocation: 15, totalUsed: 1, isOpen: true })
    expect((await list({ state: 'open' })).body.items.map((c: { id: string }) => c.id)).toEqual([current.id])
    expect((await list({ state: 'closed' })).body.items.map((c: { id: string }) => c.id)).toEqual([old.id])
    expect((await list({ productId: app.product.id })).body.total).toBe(2)
    expect((await list({ productId: '00000000-0000-4000-8000-000000000000' })).body.total).toBe(0)
  })
})

describe('quyền', () => {
  it('bán hàng mở được đợt; kho và kế toán chỉ xem được; nhân viên không có vai trò thì 403 cả khi xem', async () => {
    const app = await campaigns()
    const sales = await createStaff(app.request, app.token, ['sales'], 'ban@example.com')
    const warehouse = await createStaff(app.request, app.token, ['warehouse'], 'kho@example.com')
    const accountant = await createStaff(app.request, app.token, ['accountant'], 'ketoan@example.com')

    const created = await app.create({}, sales.accessToken)
    expect(created.status).toBe(201)
    const id = created.body.id as string

    for (const viewer of [warehouse, accountant]) {
      expect((await app.get(id, viewer.accessToken)).status).toBe(200)
      expect((await app.create({}, viewer.accessToken)).status).toBe(403)
      expect((await app.update(id, { supplyStatus: 'ordered' }, viewer.accessToken)).status).toBe(403)
      expect((await app.close(id, viewer.accessToken)).status).toBe(403)
    }
    await app.prisma.staff.update({ where: { id: warehouse.id }, data: { roles: [] } })
    expect((await app.get(id, warehouse.accessToken)).status).toBe(403)
  })
})
