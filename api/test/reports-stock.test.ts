import { describe, expect, it } from 'vitest'
import { backdateStock } from './support/backdate.ts'
import { shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'
import { adjust } from './support/stock.ts'

const SHIPMENT = { carrier: 'Giao Hàng Nhanh', trackingNumber: 'GHN1' }
const DAY = 24 * 60 * 60_000
/** Vietnam-time calendar day, `days` days from today. */
const vnDate = (days = 0) => new Date(Date.now() + 7 * 60 * 60_000 + days * DAY).toISOString().slice(0, 10)

type Figures = {
  opening: number
  received: number
  sold: number
  returned: number
  adjustedUp: number
  adjustedDown: number
  closing: number
}
type Report = {
  items: (Figures & { variantId: string; sku: string; productName: string; brandName: string; productType: string })[]
  totals: Figures
  brands: { id: string; name: string }[]
  total: number
  page: number
  pageSize: number
}

/**
 * A shop with the simulator; AM-40 has one stocktake row of +3 (from `shop()`), moved back 3 days to become today's
 * opening stock. AM-41 has no ledger rows.
 */
async function stockShop() {
  const app = await shop({ simulator: true })
  const { request, token, v40 } = app
  await backdateStock(app.prisma, v40.id, new Date(Date.now() - 3 * DAY))
  const step = (code: number, path: string, body?: Record<string, unknown>) =>
    request.post(`/api/admin/orders/${code}/${path}`).set(bearer(token)).send(body)
  const support = (code: number, path: string, body?: Record<string, unknown>) =>
    request.post(`/api/admin/support-requests/${code}/${path}`).set(bearer(token)).send(body)
  const report = async (query: Record<string, string> = {}) => {
    const res = await request
      .get('/api/admin/reports/stock')
      .query({ from: vnDate(), to: vnDate(), ...query })
      .set(bearer(token))
    expect(res.status).toBe(200)
    return res.body as Report
  }
  return { ...app, step, support, report }
}

describe('báo cáo xuất nhập tồn', () => {
  it('kho và bán hàng bị 403; kế toán xem được', async () => {
    const { request, token } = await shop()
    const query = { from: vnDate(), to: vnDate() }
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
    const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')

    const get = (as: string) => request.get('/api/admin/reports/stock').query(query).set(bearer(as))
    expect((await get(accountant.accessToken)).status).toBe(200)
    expect((await get(warehouse.accessToken)).status).toBe(403)
  })

  it('tồn đầu + nhập − xuất bán + hoàn về + tăng − giảm = tồn cuối, mỗi loại sổ vào đúng cột', async () => {
    const app = await stockShop()
    const { request, token, v40 } = app
    const receipt = await request
      .post('/api/admin/stock/receipts')
      .set(bearer(token))
      .send({ supplierName: 'Nike VN', receivedOn: vnDate(), note: '', lines: [{ sku: 'AM-40', quantity: 5 }] })
    expect(receipt.status).toBe(201)
    expect(
      (await adjust(request, token, { variantId: v40.id, reason: 'damaged', quantity: 1, expectedOnHand: 8 })).status,
    ).toBe(201)
    expect(
      (await adjust(request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 9, expectedOnHand: 7 }))
        .status,
    ).toBe(201)

    // Sell 2 pairs, then the customer returns 1 and it is restocked.
    const placed = await app.checkout({ lines: [{ variantId: v40.id, quantity: 2, price: 2_000_000 }] })
    const { code, token: orderToken } = placed.body as { code: number; token: string }
    await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount: 4_030_000 })
    for (const [path, body] of [['prepare'], ['hand-over', SHIPMENT], ['deliver']] as const) {
      expect((await app.step(code, path, body)).status).toBe(200)
    }
    const asked = await request
      .post(`/api/orders/${code}/support-requests`)
      .query({ token: orderToken })
      .send({
        kind: 'return',
        subject: 'Trả giày',
        message: 'Không vừa',
        lines: [{ variantId: v40.id, quantity: 1, reason: 'wrong_fit' }],
      })
    const requestCode = asked.body.code as number
    expect((await app.support(requestCode, 'decide', { decision: 'accepted', message: 'Gửi về nhé' })).status).toBe(200)
    const view = await request.get(`/api/admin/support-requests/${requestCode}`).set(bearer(token))
    const lines = [{ lineId: view.body.lines[0].id as string, restocked: 1, writtenOff: 0 }]
    expect((await app.support(requestCode, 'receive', { lines })).status).toBe(200)

    const today = await app.report()
    const before = await app.report({ from: vnDate(-5), to: vnDate(-1) })

    const expected = { opening: 3, received: 5, sold: 2, returned: 1, adjustedUp: 2, adjustedDown: 1, closing: 8 }
    expect(today.items).toEqual([
      {
        variantId: v40.id,
        sku: 'AM-40',
        productName: 'Air Max',
        brandName: 'Nike',
        productType: 'footwear',
        ...expected,
      },
    ])
    const { opening, received, sold, returned, adjustedUp, adjustedDown, closing } = today.items[0]!
    expect(opening + received - sold + returned + adjustedUp - adjustedDown).toBe(closing)
    expect(today.totals).toEqual(expected)
    expect(before.items).toEqual([
      expect.objectContaining({ sku: 'AM-40', opening: 0, adjustedUp: 3, received: 0, closing: 3 }),
    ])
  })

  it('tồn đầu kỳ (lúc bắt đầu dùng hệ thống) tính vào cột nhập', async () => {
    const app = await stockShop()
    const { v41 } = app
    // `opening` rows only come from Excel import; build the row and stock directly instead of a whole import file.
    const owner = await app.prisma.staff.findFirstOrThrow()
    await app.prisma.$transaction([
      app.prisma.stockMovement.create({
        data: { variantId: v41.id, kind: 'opening', quantity: 4, onHandAfter: 4, actorId: owner.id },
      }),
      app.prisma.productVariant.update({ where: { id: v41.id }, data: { onHand: 4 } }),
    ])

    const report = await app.report()

    expect(report.items).toContainEqual(
      expect.objectContaining({ sku: 'AM-41', opening: 0, received: 4, sold: 0, closing: 4 }),
    )
  })

  it('biến thể không biến động trong kỳ vẫn hiện, trừ khi chỉ xem biến thể có biến động; chưa có dòng sổ thì không hiện', async () => {
    const app = await stockShop()

    const all = await app.report()
    const moved = await app.report({ movedOnly: 'true' })

    expect(all.items).toEqual([
      expect.objectContaining({ sku: 'AM-40', opening: 3, received: 0, adjustedUp: 0, closing: 3 }),
    ])
    expect(all).toMatchObject({ total: 1, page: 1, pageSize: 100 })
    expect(moved).toMatchObject({ items: [], total: 0, totals: { opening: 0, closing: 0 } })
  })

  it('lọc theo nhóm hàng và thương hiệu; dòng tổng cộng mọi biến thể khớp bộ lọc', async () => {
    const app = await stockShop()
    const { request, token, v41, brand } = app
    expect(
      (await adjust(request, token, { variantId: v41.id, reason: 'stocktake', countedQuantity: 4, expectedOnHand: 0 }))
        .status,
    ).toBe(201)

    const all = await app.report()
    expect(all.items.map((i) => i.sku)).toEqual(['AM-40', 'AM-41'])
    expect(all.totals).toMatchObject({ opening: 3, adjustedUp: 4, closing: 7 })
    expect(all.brands).toEqual([{ id: brand.id, name: 'Nike' }])
    expect((await app.report({ productType: 'footwear', brandId: brand.id })).total).toBe(2)
    expect((await app.report({ productType: 'fragrance' })).items).toEqual([])
    expect((await app.report({ brandId: '00000000-0000-4000-8000-000000000000' })).items).toEqual([])
    const invalid = await request
      .get('/api/admin/reports/stock')
      .query({ from: vnDate(), to: vnDate(), brandId: 'khong-phai-uuid' })
      .set(bearer(token))
    expect(invalid.status).toBe(400)
  })
})
