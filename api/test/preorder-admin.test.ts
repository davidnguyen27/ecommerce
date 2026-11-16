import { describe, expect, it } from 'vitest'
import { processRemainderDeadlines } from '../src/preorders/deadlines.ts'
import { DEPOSIT, paid, preorderShop } from './support/preorder.ts'
import { ADDRESS } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const DAY = 24 * 60 * 60_000

/**
 * Một đợt AM-41 (20 suất) có: A 2 đôi đã cọc và đã về hàng, B 1 đôi đã cọc chờ hàng, P 1 đôi chờ cọc, C 1 đôi đã hủy; và
 * một đơn hàng sẵn AM-40.
 */
async function adminView() {
  const app = await preorderShop()
  const { request, token } = app
  const campaignId = await app.open([{ variantId: app.v41.id, allocation: 20 }])
  let customer = 0
  const place = async (quantity: number) => {
    customer += 1
    const phone = `09300000${String(customer).padStart(2, '0')}`
    return app.placed(campaignId, { quantity, address: { ...ADDRESS, email: `khach${customer}@example.com`, phone } })
  }
  const deposited = async (quantity: number) => {
    const order = await place(quantity)
    app.payments.payments.set(`${order.code}-deposit-1`, paid([DEPOSIT * quantity, `FT-${order.code}`]))
    await request.get(`/api/orders/${order.code}`).query({ token: order.token, refresh: '1' })
    return order
  }
  const a = await deposited(2)
  const receipt = await request
    .post('/api/admin/stock/receipts')
    .set(bearer(token))
    .send({ supplierName: 'Nike VN', receivedOn: '2026-12-01', note: '', lines: [{ sku: 'AM-41', quantity: 2 }] })
  expect(receipt.status).toBe(201)
  const b = await deposited(1)
  const p = await place(1)
  const c = await place(1)
  expect((await request.post(`/api/orders/${c.code}/cancel`).query({ token: c.token })).status).toBe(200)
  const standard = await app.checkout()
  expect(standard.status).toBe(201)

  const orders = async (query: Record<string, string>) => {
    const res = await request
      .get('/api/admin/orders')
      .query({ status: 'all', paymentStatus: 'all', fulfillmentStatus: 'all', sort: 'oldest', ...query })
      .set(bearer(token))
    expect(res.status).toBe(200)
    return (res.body.items as { code: number }[]).map((o) => o.code)
  }
  const attention = (as = token) => request.get('/api/admin/preorder-campaigns/attention').set(bearer(as))
  return { ...app, campaignId, a, b, p, c, standard: standard.body.code as number, orders, attention }
}

describe('đơn đặt trước ở trang quản trị', () => {
  it('lọc theo loại đơn, theo đợt và theo quá hạn trả phần còn lại', async () => {
    const app = await adminView()

    expect(await app.orders({ kind: 'preorder' })).toEqual([app.a.code, app.b.code, app.p.code, app.c.code])
    expect(await app.orders({ kind: 'standard' })).toEqual([app.standard])
    expect(await app.orders({ campaignId: app.campaignId })).toEqual([app.a.code, app.b.code, app.p.code, app.c.code])
    expect(await app.orders({ remainderOverdue: 'true' })).toEqual([])

    await processRemainderDeadlines(app.expireDeps, new Date(Date.now() + 8 * DAY))

    expect(await app.orders({ remainderOverdue: 'true' })).toEqual([app.a.code])
    expect(await app.orders({ remainderOverdue: 'false', kind: 'preorder' })).toEqual([
      app.b.code,
      app.p.code,
      app.c.code,
    ])
  })

  it('chi tiết đợt: đã đặt, đã cọc, chờ cọc, đã về của biến thể; đơn chưa hủy theo thứ tự cọc, đơn chờ cọc sau cùng', async () => {
    const app = await adminView()

    const res = await app.request.get(`/api/admin/preorder-campaigns/${app.campaignId}`).set(bearer(app.token))

    expect(res.body.variants).toEqual([
      expect.objectContaining({ sku: 'AM-41', allocation: 20, used: 4, deposited: 3, pendingDeposit: 1, arrived: 2 }),
    ])
    expect(res.body.orders).toEqual([
      expect.objectContaining({
        code: app.a.code,
        paymentStatus: 'deposit_paid',
        quantity: 2,
        arrivedQuantity: 2,
        depositPaidAt: expect.any(String),
        remainderDueAt: expect.any(String),
      }),
      expect.objectContaining({ code: app.b.code, quantity: 1, arrivedQuantity: 0, remainderDueAt: null }),
      expect.objectContaining({ code: app.p.code, paymentStatus: 'unpaid', depositPaidAt: null }),
    ])
  })

  it('chi tiết đơn có đợt của đơn và mục đích từng giao dịch', async () => {
    const app = await adminView()

    const res = await app.request.get(`/api/admin/orders/${app.a.code}`).set(bearer(app.token))

    expect(res.body.preorder).toMatchObject({ campaignId: app.campaignId, arrivedQuantity: 2, quantity: 2 })
    expect(res.body.payments).toEqual([expect.objectContaining({ purpose: 'deposit', amount: DEPOSIT * 2 })])
  })
})

describe('đặt trước cần xử lý', () => {
  it('có đơn quá hạn trả phần còn lại và đợt gặp sự cố còn đơn đã cọc chờ hàng; không có gì thì rỗng', async () => {
    const app = await adminView()
    expect((await app.attention()).body).toEqual({ overdueOrders: [], issueCampaigns: [], total: 0 })

    await processRemainderDeadlines(app.expireDeps, new Date(Date.now() + 8 * DAY))
    const issue = await app.request
      .patch(`/api/admin/preorder-campaigns/${app.campaignId}`)
      .set(bearer(app.token))
      .send({ supplyStatus: 'issue', supplyNote: 'Nhà cung cấp báo trễ' })
    expect(issue.status).toBe(200)

    const res = await app.attention()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      overdueOrders: [
        {
          code: app.a.code,
          recipientName: 'Nguyễn Văn An',
          phone: '0930000001',
          productName: 'Air Max',
          // 2 đôi: tổng 4.230.000 (gồm phí giao 30.000) trừ cọc 1.260.000.
          remainingAmount: 2_970_000,
          remainderDueAt: expect.any(String),
          remainderOverdueAt: expect.any(String),
        },
      ],
      issueCampaigns: [
        { id: app.campaignId, productName: 'Air Max', supplyNote: 'Nhà cung cấp báo trễ', waitingOrders: 1 },
      ],
      total: 2,
    })
  })

  it('đợt gặp sự cố nhưng không còn đơn đã cọc chờ hàng thì không cần xử lý', async () => {
    const app = await preorderShop()
    const campaignId = await app.open()
    await app.placed(campaignId)
    await app.request
      .patch(`/api/admin/preorder-campaigns/${campaignId}`)
      .set(bearer(app.token))
      .send({ supplyStatus: 'issue' })

    const res = await app.request.get('/api/admin/preorder-campaigns/attention').set(bearer(app.token))

    expect(res.body).toMatchObject({ issueCampaigns: [], total: 0 })
  })

  it('cần order.view: mọi vai trò đều xem được, nhân viên không có vai trò thì 403', async () => {
    const app = await preorderShop()
    const staff = await createStaff(app.request, app.token, ['warehouse'], 'kho@example.com')
    const attention = () => app.request.get('/api/admin/preorder-campaigns/attention').set(bearer(staff.accessToken))

    expect((await attention()).status).toBe(200)
    await app.prisma.staff.update({ where: { id: staff.id }, data: { roles: [] } })
    expect((await attention()).status).toBe(403)
  })
})
