import { describe, expect, it } from 'vitest'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const DAY = 24 * 60 * 60_000
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString()

/** Cửa hàng của `shop()` (thương hiệu Nike, danh mục Sneaker), và hàm tạo/sửa/tắt mã bằng tài khoản owner. */
async function vouchers() {
  const app = await shop()
  const { request, token } = app
  const base = (overrides: Record<string, unknown> = {}) => ({
    code: 'tet2027',
    kind: 'percent',
    percent: 10,
    maxDiscount: 500_000,
    startsAt: at(-1),
    endsAt: at(30),
    saleTypes: ['standard', 'preorder'],
    ...overrides,
  })
  const create = (overrides: Record<string, unknown> = {}, as = token) =>
    request.post('/api/admin/vouchers').set(bearer(as)).send(base(overrides))
  const update = (id: string, body: Record<string, unknown>, as = token) =>
    request.patch(`/api/admin/vouchers/${id}`).set(bearer(as)).send(body)
  const disable = (id: string, as = token) => request.post(`/api/admin/vouchers/${id}/disable`).set(bearer(as))
  const get = (id: string, as = token) => request.get(`/api/admin/vouchers/${id}`).set(bearer(as))
  const list = (query: Record<string, string> = {}) =>
    request.get('/api/admin/vouchers').query(query).set(bearer(token))
  const audits = async () => {
    const res = await request.get('/api/admin/audit').query({ entityType: 'voucher' }).set(bearer(token))
    expect(res.status).toBe(200)
    return res.body.items as { action: string; before: unknown; after: unknown }[]
  }
  const created = async (overrides?: Record<string, unknown>) => {
    const res = await create(overrides)
    expect(res.status).toBe(201)
    return res.body as { id: string; code: string; used: number; status: string }
  }
  /** Khách thứ `n` (email, số điện thoại riêng) đặt 1 đôi AM-40 kèm mã, với tiền giảm như báo giá; đơn chờ thanh toán. */
  const redeemed = async (voucher: { code: string }, n = 1) => {
    const lines = [{ variantId: app.v40.id, quantity: 1 }]
    const quote = await request.post('/api/checkout/quote').send({ lines, voucherCode: voucher.code })
    expect(quote.body.voucher).toMatchObject({ applied: true })
    const address = { ...ADDRESS, email: `khach${n}@example.com`, phone: `091000000${n}` }
    const res = await app.checkout({ address, voucherCode: voucher.code, discount: quote.body.discount })
    expect(res.status).toBe(201)
    return res.body as { code: number }
  }
  return { ...app, create, update, disable, get, list, audits, created, redeemed }
}

describe('tạo mã giảm giá', () => {
  it('tạo mã giảm theo tỷ lệ có phạm vi; mã lưu chữ hoa; mặc định 1 lượt mỗi khách; ghi audit', async () => {
    const app = await vouchers()

    const res = await app.create({ brandIds: [app.brand.id], categoryIds: [app.category.id], description: 'Tết' })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      code: 'TET2027',
      description: 'Tết',
      kind: 'percent',
      percent: 10,
      maxDiscount: 500_000,
      amount: null,
      minSubtotal: 0,
      saleTypes: ['preorder', 'standard'],
      totalLimit: null,
      perCustomerLimit: 1,
      brands: [{ id: app.brand.id, name: 'Nike' }],
      categories: [{ id: app.category.id, name: 'Sneaker' }],
      status: 'active',
      used: 0,
      disabledAt: null,
      createdBy: { email: 'chu@example.com' },
    })
    expect(await app.audits()).toEqual([
      expect.objectContaining({ action: 'voucher.create', after: expect.objectContaining({ code: 'TET2027' }) }),
    ])
  })

  it('tạo mã giảm số tiền cố định, giới hạn tổng lượt và đơn tối thiểu', async () => {
    const app = await vouchers()
    const res = await app.create({
      kind: 'fixed',
      amount: 200_000,
      percent: null,
      maxDiscount: null,
      minSubtotal: 2_000_000,
      totalLimit: 100,
      perCustomerLimit: 2,
      saleTypes: ['standard'],
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      kind: 'fixed',
      amount: 200_000,
      percent: null,
      totalLimit: 100,
      perCustomerLimit: 2,
    })
  })

  it('mã trùng với mã đã có, kể cả khác hoa thường, thì 409', async () => {
    const app = await vouchers()
    await app.created()
    const res = await app.create({ code: 'Tet2027' })
    expect(res.status).toBe(409)
    expect(res.body.error.fields).toEqual([expect.objectContaining({ path: 'code' })])
  })

  it('từ chối mã sai định dạng, tỷ lệ quá 50%, thiếu mức tối đa, trộn hai loại, thời hạn ngược và phạm vi lạ', async () => {
    const app = await vouchers()
    const cases: [Record<string, unknown>, string][] = [
      [{ code: 'ab' }, 'code'],
      [{ code: 'TẾT2027' }, 'code'],
      [{ percent: 51 }, 'percent'],
      [{ maxDiscount: null }, 'maxDiscount'],
      [{ amount: 100_000 }, 'amount'],
      [{ kind: 'fixed', amount: null, percent: null, maxDiscount: null }, 'amount'],
      [{ endsAt: at(-2) }, 'endsAt'],
      [{ saleTypes: [] }, 'saleTypes'],
      [{ brandIds: ['00000000-0000-4000-8000-000000000000'] }, 'brandIds.0'],
      [{ categoryIds: ['00000000-0000-4000-8000-000000000000'] }, 'categoryIds.0'],
    ]
    for (const [overrides, path] of cases) {
      const res = await app.create(overrides)
      expect(res.status, JSON.stringify(overrides)).toBe(400)
      expect(res.body.error.fields.map((f: { path: string }) => f.path)).toContain(path)
    }
    expect((await app.list()).body.total).toBe(0)
  })
})

describe('sửa mã giảm giá', () => {
  it('mã chưa có lượt dùng sửa được mọi trường, kể cả đổi loại và phạm vi; ghi audit chỉ các trường đổi', async () => {
    const app = await vouchers()
    const voucher = await app.created()

    const res = await app.update(voucher.id, {
      kind: 'fixed',
      amount: 150_000,
      percent: null,
      maxDiscount: null,
      brandIds: [app.brand.id],
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ kind: 'fixed', amount: 150_000, percent: null, brands: [{ name: 'Nike' }] })
    const [update] = await app.audits()
    expect(update).toMatchObject({
      action: 'voucher.update',
      before: { kind: 'percent', amount: null, percent: 10, maxDiscount: 500_000, brandIds: [] },
      after: { kind: 'fixed', amount: 150_000, percent: null, maxDiscount: null, brandIds: [app.brand.id] },
    })
  })

  it('đổi loại mà thiếu trường đi kèm thì 400 và không ghi gì', async () => {
    const app = await vouchers()
    const voucher = await app.created()
    const res = await app.update(voucher.id, { kind: 'fixed' })
    expect(res.status).toBe(400)
    expect((await app.get(voucher.id)).body.kind).toBe('percent')
  })

  it('gửi lại đúng giá trị hiện tại thì 200 và không ghi audit', async () => {
    const app = await vouchers()
    const voucher = await app.created()
    const res = await app.update(voucher.id, { percent: 10, saleTypes: ['preorder', 'standard'] })
    expect(res.status).toBe(200)
    expect((await app.audits()).map((a) => a.action)).toEqual(['voucher.create'])
  })

  it('mã đã có lượt dùng chỉ sửa được mô tả, thời điểm kết thúc và tổng lượt (không dưới số đã dùng)', async () => {
    const app = await vouchers()
    const voucher = await app.created({ totalLimit: 10 })
    await app.redeemed(voucher)
    expect((await app.get(voucher.id)).body.used).toBe(1)

    for (const body of [
      { percent: 20 },
      { minSubtotal: 1_000_000 },
      { brandIds: [app.brand.id] },
      { startsAt: at(-3) },
    ]) {
      const res = await app.update(voucher.id, body)
      expect(res.status, JSON.stringify(body)).toBe(409)
      expect(res.body.error.fields).toEqual([expect.objectContaining({ path: Object.keys(body)[0] })])
    }
    expect((await app.update(voucher.id, { totalLimit: 0 })).status).toBe(400)

    const ok = await app.update(voucher.id, { description: 'Gia hạn', endsAt: at(60), totalLimit: 1 })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ description: 'Gia hạn', totalLimit: 1, used: 1 })
  })

  it('giảm tổng lượt dưới số đã dùng thì 409; đơn đã hủy không tính lượt', async () => {
    const app = await vouchers()
    const voucher = await app.created()
    const first = await app.redeemed(voucher, 1)
    await app.redeemed(voucher, 2)

    const below = await app.update(voucher.id, { totalLimit: 1 })
    expect(below.status).toBe(409)
    expect(below.body.error.fields).toEqual([expect.objectContaining({ path: 'totalLimit' })])

    const cancel = await app.request.post(`/api/admin/orders/${first.code}/cancel`).set(bearer(app.token))
    expect(cancel.status).toBe(200)
    expect((await app.get(voucher.id)).body.used).toBe(1)
    expect((await app.update(voucher.id, { totalLimit: 1 })).status).toBe(200)
  })
})

describe('tắt mã giảm giá', () => {
  it('tắt mã ghi audit; tắt lại thì 200 không ghi gì; mã đã tắt không sửa được', async () => {
    const app = await vouchers()
    const voucher = await app.created()

    const res = await app.disable(voucher.id)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'disabled', disabledAt: expect.any(String) })

    expect((await app.disable(voucher.id)).status).toBe(200)
    const audits = await app.audits()
    expect(audits.map((a) => a.action)).toEqual(['voucher.disable', 'voucher.create'])
    expect(audits[0]).toMatchObject({ before: { disabledAt: null }, after: { disabledAt: expect.any(String) } })
    expect((await app.update(voucher.id, { endsAt: at(90) })).status).toBe(409)
  })

  it('không có endpoint xóa mã', async () => {
    const app = await vouchers()
    const voucher = await app.created()
    expect((await app.request.delete(`/api/admin/vouchers/${voucher.id}`).set(bearer(app.token))).status).toBe(404)
  })
})

describe('danh sách mã', () => {
  it('lọc theo trạng thái, tìm theo một phần mã, kèm số lượt đã dùng', async () => {
    const app = await vouchers()
    const active = await app.created({ code: 'TET2027' })
    const upcoming = await app.created({ code: 'HE2027', startsAt: at(10), endsAt: at(20) })
    const expired = await app.created({ code: 'THU2026', startsAt: at(-20), endsAt: at(-10) })
    const disabled = await app.created({ code: 'LOI2026' })
    await app.disable(disabled.id)
    await app.redeemed(active)

    const ids = async (query: Record<string, string>) =>
      (await app.list(query)).body.items.map((v: { id: string }) => v.id)
    expect(await ids({ status: 'active' })).toEqual([active.id])
    expect(await ids({ status: 'upcoming' })).toEqual([upcoming.id])
    expect(await ids({ status: 'expired' })).toEqual([expired.id])
    expect(await ids({ status: 'disabled' })).toEqual([disabled.id])
    expect(await ids({ q: '2027' })).toEqual([upcoming.id, active.id])
    expect(await ids({ q: 'tet' })).toEqual([active.id])

    const all = await app.list()
    expect(all.body.total).toBe(4)
    expect(all.body.items.find((v: { id: string }) => v.id === active.id).used).toBe(1)
  })
})

describe('quyền', () => {
  it('bán hàng tạo được mã; kho và kế toán chỉ xem được; nhân viên không có vai trò thì 403 cả khi xem', async () => {
    const app = await vouchers()
    const sales = await createStaff(app.request, app.token, ['sales'], 'ban@example.com')
    const warehouse = await createStaff(app.request, app.token, ['warehouse'], 'kho@example.com')
    const accountant = await createStaff(app.request, app.token, ['accountant'], 'ketoan@example.com')

    const created = await app.create({}, sales.accessToken)
    expect(created.status).toBe(201)
    const id = created.body.id as string

    for (const viewer of [warehouse, accountant]) {
      expect((await app.get(id, viewer.accessToken)).status).toBe(200)
      expect((await app.create({ code: 'KHAC2027' }, viewer.accessToken)).status).toBe(403)
      expect((await app.update(id, { description: 'x' }, viewer.accessToken)).status).toBe(403)
      expect((await app.disable(id, viewer.accessToken)).status).toBe(403)
    }
    await app.prisma.staff.update({ where: { id: warehouse.id }, data: { roles: [] } })
    expect((await app.get(id, warehouse.accessToken)).status).toBe(403)
  })
})
