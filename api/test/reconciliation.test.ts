import { describe, expect, it, vi } from 'vitest'
import { shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const TOTAL = 2_030_000

/**
 * Cửa hàng có cổng giả lập và một kế toán. `cancelledThenPaid` dựng đơn khách tự hủy rồi tiền mới về (cần đối soát
 * `paid_after_cancel`).
 */
async function reconciliation() {
  const app = await shop({ simulator: true })
  const { request, token, checkout } = app
  const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')

  const place = async (quantity = 1) => {
    const res = await checkout({ lines: [{ variantId: app.v40.id, quantity, price: 2_000_000 }] })
    expect(res.status).toBe(201)
    return res.body as { code: number; token: string }
  }
  const pay = async (code: number, amount = TOTAL) => {
    const res = await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount })
    expect(res.status).toBe(204)
  }
  const cancel = async (placed: { code: number; token: string }) => {
    const res = await request.post(`/api/orders/${placed.code}/cancel`).query({ token: placed.token })
    expect(res.status).toBe(200)
  }
  const cancelledThenPaid = async (...amounts: number[]) => {
    const placed = await place()
    await cancel(placed)
    for (const amount of amounts.length ? amounts : [TOTAL]) await pay(placed.code, amount)
    return placed.code
  }
  const detail = async (code: number) => {
    const res = await request.get(`/api/admin/orders/${code}`).set(bearer(token))
    expect(res.status).toBe(200)
    return res.body as {
      status: string
      paymentStatus: string
      cancelReason: string | null
      payments: { reconciliation: { id: string; status: string; resolution: string | null } | null }[]
      history: { action: string; data: unknown }[]
    }
  }
  /** Id các mục cần đối soát của đơn, theo thứ tự tiền về. */
  const itemIds = async (code: number) =>
    (await detail(code)).payments.flatMap((p) => (p.reconciliation ? [p.reconciliation.id] : []))
  const restore = (id: string, as = accountant.accessToken) =>
    request.post(`/api/admin/reconciliation/${id}/restore`).set(bearer(as))
  const resolve = (id: string, body: Record<string, unknown>, as = accountant.accessToken) =>
    request.post(`/api/admin/reconciliation/${id}/resolve`).set(bearer(as)).send(body)
  const reserved = async () => {
    const stock = await request.get('/api/admin/stock').query({ q: 'AM-40' }).set(bearer(token))
    return (stock.body.items as { reserved: number }[])[0]!.reserved
  }
  const audits = async () => {
    const res = await request.get('/api/admin/audit').query({ entityType: 'order' }).set(bearer(token))
    return res.body.items as { action: string; actor: { id: string }; before: unknown; after: unknown }[]
  }
  return {
    ...app,
    accountant,
    sales,
    place,
    pay,
    cancel,
    cancelledThenPaid,
    detail,
    itemIds,
    restore,
    resolve,
    reserved,
    audits,
  }
}

describe('danh sách cần đối soát', () => {
  it('có số tiền nhận, số tiền của đơn và lý do; đọc được với order.view; mặc định chỉ mục chưa xử lý', async () => {
    const { request, sales, cancelledThenPaid, place, pay, itemIds, resolve } = await reconciliation()
    const cancelled = await cancelledThenPaid()
    const short = await place()
    await pay(short.code, 1_000_000)

    const res = await request.get('/api/admin/reconciliation').set(bearer(sales.accessToken))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ total: 2, page: 1 })
    expect(res.body.items).toEqual([
      expect.objectContaining({
        reason: 'paid_after_cancel',
        status: 'open',
        amount: TOTAL,
        resolution: null,
        order: expect.objectContaining({ code: cancelled, status: 'cancelled', total: TOTAL, received: TOTAL }),
      }),
      expect.objectContaining({
        reason: 'amount_mismatch',
        amount: 1_000_000,
        order: expect.objectContaining({ code: short.code, status: 'pending_payment', received: 1_000_000 }),
      }),
    ])

    const [id] = await itemIds(short.code)
    expect((await resolve(id!, { note: 'Hoàn 1.000.000 qua VCB, mã FT123' })).status).toBe(200)
    const open = await request.get('/api/admin/reconciliation').set(bearer(sales.accessToken))
    const all = await request.get('/api/admin/reconciliation').query({ status: 'all' }).set(bearer(sales.accessToken))
    expect(open.body.items.map((i: { order: { code: number } }) => i.order.code)).toEqual([cancelled])
    expect(all.body.total).toBe(2)
  })
})

describe('khôi phục đơn', () => {
  it('đơn đã hủy nhận đủ tiền: giữ lại hàng, thành đã trả đủ, gửi email đã nhận thanh toán, đóng mục, ghi audit', async () => {
    const { cancelledThenPaid, itemIds, restore, detail, reserved, audits, accountant, mailer } = await reconciliation()
    const code = await cancelledThenPaid()
    expect(await reserved()).toBe(0)
    const [id] = await itemIds(code)

    const res = await restore(id!)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      code,
      status: 'processing',
      paymentStatus: 'paid',
      fulfillmentStatus: 'not_prepared',
      cancelReason: null,
      cancelledAt: null,
      reservedUntil: null,
    })
    expect(res.body.payments[0].reconciliation).toMatchObject({
      id,
      status: 'resolved',
      resolution: 'restored',
      resolvedBy: { id: accountant.id },
    })
    expect(await reserved()).toBe(1)
    const order = await detail(code)
    expect(order.history).toContainEqual(
      expect.objectContaining({
        action: 'restored',
        actor: expect.objectContaining({ id: accountant.id }),
      }),
    )
    expect(await audits()).toContainEqual(
      expect.objectContaining({
        action: 'reconciliation.restore',
        actor: expect.objectContaining({ id: accountant.id }),
        before: { status: 'cancelled', paymentStatus: 'unpaid', cancelReason: 'customer' },
        after: { status: 'processing', paymentStatus: 'paid', reconciliationItemIds: [id] },
      }),
    )
    const mails = await vi.waitFor(
      () => {
        const sent = mailer.sent.filter((m) => m.subject === `Đã nhận thanh toán đơn hàng #${code}`)
        if (sent.length === 0) throw new Error('Chưa có thư')
        return sent
      },
      { timeout: 10_000, interval: 100 },
    )
    expect(mails).toHaveLength(1)
    expect(mails[0]!.text).toContain('/don-hang/')

    // Đã khôi phục thì không khôi phục lần nữa.
    expect((await restore(id!)).status).toBe(409)
  })

  it('trả làm hai lần sau khi hủy, cộng lại đủ: khôi phục bằng một mục thì đóng mọi mục còn mở của đơn', async () => {
    const { cancelledThenPaid, itemIds, restore, detail } = await reconciliation()
    const code = await cancelledThenPaid(1_000_000, 1_030_000)
    const ids = await itemIds(code)
    expect(ids).toHaveLength(2)

    expect((await restore(ids[1]!)).status).toBe(200)

    const order = await detail(code)
    expect(order.status).toBe('processing')
    expect(order.payments.map((p) => p.reconciliation)).toEqual([
      expect.objectContaining({ status: 'resolved', resolution: 'restored' }),
      expect.objectContaining({ status: 'resolved', resolution: 'restored' }),
    ])
  })

  it('không còn đủ hàng thì 409 theo dòng, đơn vẫn hủy, mục vẫn mở', async () => {
    const { cancelledThenPaid, place, itemIds, restore, detail, v40 } = await reconciliation()
    const code = await cancelledThenPaid()
    // Đơn khác giữ hết 3 đôi AM-40.
    await place(3)
    const [id] = await itemIds(code)

    const res = await restore(id!)

    expect(res.status).toBe(409)
    expect(res.body.error.details).toEqual({ lines: [{ variantId: v40.id, sku: 'AM-40' }] })
    const order = await detail(code)
    expect(order.status).toBe('cancelled')
    expect(order.payments[0]!.reconciliation).toMatchObject({ status: 'open', resolution: null })
  })

  it('tổng đã nhận lệch tổng đơn thì bị từ chối; đơn chưa hủy cũng không khôi phục được', async () => {
    const { cancelledThenPaid, place, pay, itemIds, restore, detail, audits } = await reconciliation()
    const underpaid = await cancelledThenPaid(1_000_000)
    const paid = await place()
    await pay(paid.code)
    await pay(paid.code, 50_000)

    const mismatch = await restore((await itemIds(underpaid))[0]!)
    const extra = await restore((await itemIds(paid.code))[0]!)

    expect(mismatch.status).toBe(409)
    expect(mismatch.body.error.message).toMatch(/tổng/i)
    expect(extra.status).toBe(409)
    expect((await detail(underpaid)).status).toBe('cancelled')
    expect(await audits()).toEqual([])
  })

  it('mục đã đóng ngoài hệ thống trên đơn thì không khôi phục được', async () => {
    const { cancelledThenPaid, itemIds, restore, resolve } = await reconciliation()
    const code = await cancelledThenPaid(1_000_000, 1_030_000)
    const [first, second] = await itemIds(code)
    expect((await resolve(first!, { note: 'Đã hoàn 1.000.000, mã FT1' })).status).toBe(200)

    const res = await restore(second!)

    expect(res.status).toBe(409)
  })
})

describe('đã xử lý ngoài hệ thống', () => {
  it('ghi chú bắt buộc; đóng mục, không đổi trạng thái đơn, ghi sự kiện và audit', async () => {
    const { cancelledThenPaid, itemIds, resolve, detail, audits, accountant } = await reconciliation()
    const code = await cancelledThenPaid()
    const [id] = await itemIds(code)

    const missing = await resolve(id!, {})
    const blank = await resolve(id!, { note: '   ' })
    expect(missing.status).toBe(400)
    expect(blank.status).toBe(400)
    expect(blank.body.error.fields).toEqual([expect.objectContaining({ path: 'note' })])

    const res = await resolve(id!, { note: 'Hoàn 2.030.000 qua VCB, mã FT999' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'cancelled', paymentStatus: 'unpaid' })
    expect(res.body.payments[0].reconciliation).toMatchObject({
      status: 'resolved',
      resolution: 'handled_externally',
      note: 'Hoàn 2.030.000 qua VCB, mã FT999',
      resolvedBy: { id: accountant.id },
    })
    expect((await detail(code)).history).toContainEqual(expect.objectContaining({ action: 'reconciliation_resolved' }))
    expect(await audits()).toEqual([
      expect.objectContaining({
        action: 'reconciliation.resolve',
        actor: expect.objectContaining({ id: accountant.id }),
        before: { reconciliationItemId: id, status: 'open' },
        after: { reconciliationItemId: id, status: 'resolved', note: 'Hoàn 2.030.000 qua VCB, mã FT999' },
      }),
    ])

    // Đóng rồi thì không đóng lại.
    expect((await resolve(id!, { note: 'lần hai' })).status).toBe(409)
  })
})

describe('quyền đối soát', () => {
  it('thiếu payment.reconcile thì 403, không đổi gì; mục lạ thì 404', async () => {
    const { cancelledThenPaid, itemIds, restore, resolve, sales, detail, audits } = await reconciliation()
    const code = await cancelledThenPaid()
    const [id] = await itemIds(code)

    expect((await restore(id!, sales.accessToken)).status).toBe(403)
    expect((await resolve(id!, { note: 'x' }, sales.accessToken)).status).toBe(403)
    expect((await restore('00000000-0000-4000-8000-000000000000')).status).toBe(404)
    expect((await restore('khong-phai-uuid')).status).toBe(404)
    expect((await detail(code)).status).toBe('cancelled')
    expect(await audits()).toEqual([])
  })
})
