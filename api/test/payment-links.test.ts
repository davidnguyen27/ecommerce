import { describe, expect, it } from 'vitest'
import { expireOverdueOrders } from '../src/orders/cancel-order.ts'
import type { PaymentInfo } from '../src/payments/gateway.ts'
import { shop } from './support/shop.ts'
import { bearer } from './support/staff.ts'

const TOTAL = 2_030_000
const MINUTE = 60_000
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * MINUTE)

/** Cổng trả lời truy vấn: link đã nhận một khoản. */
const paidInfo = (amount: number, reference: string): PaymentInfo => ({
  status: 'paid',
  transactions: [{ reference, amount, paidAt: new Date('2026-11-02T03:20:00Z') }],
})

/** Cửa hàng đã có một đơn AM-40 chờ thanh toán, tổng 2.030.000, có một link trả đủ mã `String(code)`. */
async function pendingOrder() {
  const app = await shop()
  const res = await app.checkout()
  expect(res.status).toBe(201)
  const { code, token: orderToken } = res.body as { code: number; token: string }
  const order = () => app.request.get(`/api/orders/${code}`).query({ token: orderToken })
  const refresh = () => app.request.get(`/api/orders/${code}`).query({ token: orderToken, refresh: '1' })
  const transactions = async () => {
    const detail = await app.request.get(`/api/admin/orders/${code}`).set(bearer(app.token))
    expect(detail.status).toBe(200)
    return detail.body.payments as { purpose: string; amount: number; reference: string; reconciliation: unknown }[]
  }
  const { id: orderId } = await app.prisma.order.findUniqueOrThrow({ where: { code }, select: { id: true } })
  /** Thêm một link như M4 sẽ tạo (cọc, phần còn lại), dựng thẳng bằng SQL vì chưa có route nào tạo. */
  const addLink = (purpose: 'deposit' | 'remainder', amount: number, gatewayReference: string) =>
    app.prisma.paymentLink.create({
      data: { orderId, purpose, amount, gatewayReference, expiresAt: inMinutes(15) },
    })
  return { ...app, code, orderId, orderToken, order, refresh, transactions, addLink }
}

describe('link thanh toán', () => {
  it('đặt mua lưu một link trả đủ: đúng tổng phải trả, hạn bằng hạn giữ hàng, mã bên cổng do cổng trả', async () => {
    const { prisma, orderId, payments } = await pendingOrder()

    const links = await prisma.paymentLink.findMany({ where: { orderId } })
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })

    expect(links).toEqual([
      expect.objectContaining({
        purpose: 'full',
        amount: BigInt(TOTAL),
        gatewayReference: String(order.code),
        expiresAt: order.reservedUntil,
      }),
    ])
    expect(payments.created).toEqual([
      expect.objectContaining({ orderCode: order.code, purpose: 'full', amount: TOTAL }),
    ])
  })

  it('đơn có link dựng như migration chuyển sang (hạn 15 phút từ lúc đặt): refresh=1 vẫn ghi nhận, giao dịch là trả đủ', async () => {
    const { prisma, code, orderId, refresh, transactions, payments } = await pendingOrder()
    // Đúng dạng bản ghi migration tạo từ "order"."gateway_reference" cũ.
    await prisma.$executeRaw`DELETE FROM "payment_link" WHERE "order_id" = ${orderId}::uuid`
    await prisma.$executeRaw`
      INSERT INTO "payment_link" ("id", "order_id", "purpose", "amount", "gateway_reference", "created_at", "expires_at")
      SELECT gen_random_uuid(), "id", 'full', "total", ${String(code)}, "created_at", "created_at" + INTERVAL '15 minutes'
      FROM "order" WHERE "id" = ${orderId}::uuid`
    payments.payments.set(String(code), paidInfo(TOTAL, 'FT-OLD'))

    const res = await refresh()

    expect(res.body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    expect(await transactions()).toEqual([expect.objectContaining({ purpose: 'full', reference: 'FT-OLD' })])
  })

  it('đơn có link dựng như migration: hết hạn thì hủy và hủy link', async () => {
    const { prisma, code, orderId, order, payments, expireDeps } = await pendingOrder()
    await prisma.$executeRaw`DELETE FROM "payment_link" WHERE "order_id" = ${orderId}::uuid`
    await prisma.$executeRaw`
      INSERT INTO "payment_link" ("id", "order_id", "purpose", "amount", "gateway_reference", "created_at", "expires_at")
      SELECT gen_random_uuid(), "id", 'full', "total", ${String(code)}, "created_at", "created_at" + INTERVAL '15 minutes'
      FROM "order" WHERE "id" = ${orderId}::uuid`

    expect(await expireOverdueOrders(expireDeps, inMinutes(16))).toBe(1)

    expect((await order()).body).toMatchObject({ status: 'cancelled', cancelReason: 'expired' })
    expect(payments.cancelled).toEqual([String(code)])
  })

  it('truy vấn duyệt mọi link của đơn; giao dịch mang mục đích của link nó về qua', async () => {
    const { code, refresh, transactions, payments, addLink } = await pendingOrder()
    await addLink('deposit', 600_000, `${code}-deposit-1`)
    payments.payments.set(`${code}-deposit-1`, paidInfo(600_000, 'FT-DEP'))
    payments.payments.set(String(code), paidInfo(TOTAL, 'FT-FULL'))

    const res = await refresh()

    expect(res.body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
    const purposes = Object.fromEntries((await transactions()).map((t) => [t.reference, t.purpose]))
    expect(purposes).toEqual({ 'FT-FULL': 'full', 'FT-DEP': 'deposit' })
  })

  it('khoản về qua link không phải trả đủ thì không làm đơn hàng sẵn thành đã trả, dù đúng tổng tiền', async () => {
    const { code, refresh, transactions, payments, addLink } = await pendingOrder()
    await addLink('deposit', TOTAL, `${code}-deposit-1`)
    payments.payments.set(`${code}-deposit-1`, paidInfo(TOTAL, 'FT-DEP'))

    const res = await refresh()

    expect(res.body).toMatchObject({ status: 'pending_payment', paymentStatus: 'unpaid' })
    expect(await transactions()).toEqual([
      expect.objectContaining({
        purpose: 'deposit',
        reconciliation: expect.objectContaining({ reason: 'amount_mismatch', status: 'open' }),
      }),
    ])
  })

  it('hủy đơn thì hủy mọi link của đơn, cũ trước', async () => {
    const { code, order, payments, addLink, orderToken, request } = await pendingOrder()
    await addLink('deposit', 600_000, `${code}-deposit-1`)

    const res = await request.post(`/api/orders/${code}/cancel`).query({ token: orderToken })

    expect(res.status).toBe(200)
    expect((await order()).body).toMatchObject({ status: 'cancelled' })
    expect(payments.cancelled).toEqual([String(code), `${code}-deposit-1`])
  })

  it('hai link không mang cùng mã đơn bên cổng', async () => {
    const { code, addLink } = await pendingOrder()

    await expect(addLink('deposit', 600_000, String(code))).rejects.toMatchObject({ code: 'P2002' })
  })

  it('giao dịch thanh toán vẫn không sửa được, kể cả cột mục đích', async () => {
    const { prisma, code, refresh, payments } = await pendingOrder()
    payments.payments.set(String(code), paidInfo(TOTAL, 'FT-1'))
    await refresh()

    await expect(
      prisma.$executeRaw`UPDATE "payment_transaction" SET "purpose" = 'deposit' WHERE "reference" = 'FT-1'`,
    ).rejects.toThrow(/chỉ cho phép thêm mới/)
  })
})
