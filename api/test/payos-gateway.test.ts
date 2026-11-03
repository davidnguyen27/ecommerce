import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PayosPaymentGateway } from '../src/payments/payos.ts'
import { payosResponseSignature } from './support/payos.ts'
import { shop } from './support/shop.ts'
import { bearer } from './support/staff.ts'

const KEYS = { clientId: 'client-1', apiKey: 'api-1', checksumKey: 'checksum-1' }

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

/** HTTP giả thay cho PayOS: ghi lại request, trả lần lượt các response đã xếp. */
function fakePayos(...responses: (Response | Error)[]) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const next = responses.shift()
    if (!next) throw new Error('Không còn response giả')
    if (next instanceof Error) throw next
    return next
  }
  return { calls, gateway: new PayosPaymentGateway({ ...KEYS, fetch }) }
}

/** Response thành công theo envelope của PayOS, `data` ký bằng checksum key. */
const ok = (data: Record<string, unknown>) =>
  Response.json({ code: '00', desc: 'success', data, signature: payosResponseSignature(data, KEYS.checksumKey) })

const LINK = {
  orderCode: 100123,
  amount: 2_030_000,
  description: 'DH100123',
  returnUrl: 'https://shop.test/don-hang/100123?ket-qua=1',
  cancelUrl: 'https://shop.test/don-hang/100123?ket-qua=1',
  expiresAt: new Date('2026-11-02T03:15:00Z'),
}

const createdData = {
  bin: '970422',
  accountNumber: '12345678',
  accountName: 'CONG TY A',
  amount: 2_030_000,
  description: 'DH100123',
  orderCode: 100123,
  currency: 'VND',
  paymentLinkId: 'link-1',
  status: 'PENDING',
  expiredAt: 1793589300,
  checkoutUrl: 'https://pay.payos.vn/web/link-1',
  qrCode: '000201...',
}

const transaction = {
  reference: 'FT123',
  amount: 2_030_000,
  accountNumber: '12345678',
  description: 'DH100123',
  transactionDateTime: '2026-11-02 10:15:30',
  virtualAccountName: null,
  virtualAccountNumber: null,
  counterAccountBankId: null,
  counterAccountBankName: null,
  counterAccountName: null,
  counterAccountNumber: null,
}

const linkInfo = (status: string, transactions: Record<string, unknown>[] = []) => ({
  id: 'link-1',
  orderCode: 100123,
  amount: 2_030_000,
  amountPaid: transactions.reduce((sum, t) => sum + Number(t.amount), 0),
  amountRemaining: 0,
  status,
  createdAt: '2026-11-02T10:00:00+07:00',
  transactions,
  cancellationReason: null,
  canceledAt: null,
})

describe('cổng PayOS', () => {
  it('tạo link gửi POST /v2/payment-requests có khóa ở header, hạn là Unix timestamp và chữ ký năm trường', async () => {
    const { calls, gateway } = fakePayos(ok(createdData))

    const link = await gateway.createLink(LINK)

    expect(link).toEqual({ checkoutUrl: 'https://pay.payos.vn/web/link-1' })
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.method).toBe('POST')
    expect(call.url).toBe('https://api-merchant.payos.vn/v2/payment-requests')
    expect(call.headers['x-client-id']).toBe('client-1')
    expect(call.headers['x-api-key']).toBe('api-1')
    expect(call.headers['content-type']).toBe('application/json')
    // Chữ ký theo tài liệu PayOS: amount, cancelUrl, description, orderCode, returnUrl theo alphabet.
    const signed =
      'amount=2030000&cancelUrl=https://shop.test/don-hang/100123?ket-qua=1&description=DH100123' +
      '&orderCode=100123&returnUrl=https://shop.test/don-hang/100123?ket-qua=1'
    expect(call.body).toEqual({
      orderCode: 100123,
      amount: 2_030_000,
      description: 'DH100123',
      returnUrl: LINK.returnUrl,
      cancelUrl: LINK.cancelUrl,
      expiredAt: 1793589300,
      signature: createHmac('sha256', 'checksum-1').update(signed).digest('hex'),
    })
  })

  it('response tạo link sai chữ ký thì báo lỗi cổng', async () => {
    const { gateway } = fakePayos(
      Response.json({ code: '00', desc: 'success', data: createdData, signature: 'ab'.repeat(32) }),
    )

    await expect(gateway.createLink(LINK)).rejects.toThrow('PayOS: chữ ký response không khớp')
  })

  it('PayOS trả mã lỗi thì báo lỗi cổng kèm mã và mô tả', async () => {
    const { gateway } = fakePayos(Response.json({ code: '231', desc: 'Đơn thanh toán đã tồn tại', data: null }))

    await expect(gateway.createLink(LINK)).rejects.toThrow('PayOS 231: Đơn thanh toán đã tồn tại')
  })

  it('PayOS trả HTTP lỗi thì báo lỗi cổng kèm status', async () => {
    const { gateway } = fakePayos(new Response('Unauthorized', { status: 401 }))

    await expect(gateway.createLink(LINK)).rejects.toThrow('PayOS trả HTTP 401')
  })

  it('lỗi mạng thì báo lỗi cổng', async () => {
    const { gateway } = fakePayos(new TypeError('fetch failed'))

    await expect(gateway.createLink(LINK)).rejects.toThrow('PayOS: không gọi được API')
  })

  it('truy vấn gửi GET /v2/payment-requests/{mã đơn} và trả các giao dịch với giờ Việt Nam', async () => {
    const { calls, gateway } = fakePayos(ok(linkInfo('PAID', [transaction])))

    const info = await gateway.getPayment(100123)

    expect(calls[0]!.method).toBe('GET')
    expect(calls[0]!.url).toBe('https://api-merchant.payos.vn/v2/payment-requests/100123')
    expect(calls[0]!.headers['x-client-id']).toBe('client-1')
    expect(info).toEqual({
      status: 'paid',
      amountPaid: 2_030_000,
      transactions: [
        { reference: 'FT123', amount: 2_030_000, paidAt: new Date('2026-11-02T03:15:30Z'), payload: transaction },
      ],
    })
  })

  it.each([
    ['PENDING', 'pending'],
    ['PROCESSING', 'pending'],
    ['PAID', 'paid'],
    ['UNDERPAID', 'underpaid'],
    ['CANCELLED', 'cancelled'],
    ['EXPIRED', 'expired'],
    ['FAILED', 'failed'],
  ])('trạng thái %s của PayOS thành %s', async (payos, expected) => {
    const { gateway } = fakePayos(ok(linkInfo(payos)))

    expect((await gateway.getPayment(100123)).status).toBe(expected)
  })

  it('trạng thái lạ thì báo lỗi cổng thay vì đoán', async () => {
    const { gateway } = fakePayos(ok(linkInfo('REFUNDED')))

    await expect(gateway.getPayment(100123)).rejects.toThrow('PayOS: response không đúng định dạng')
  })

  it('hủy link gửi POST /v2/payment-requests/{mã đơn}/cancel kèm lý do', async () => {
    const { calls, gateway } = fakePayos(ok({ ...linkInfo('CANCELLED'), cancellationReason: 'Đơn đã hủy' }))

    await gateway.cancelLink(100123)

    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe('https://api-merchant.payos.vn/v2/payment-requests/100123/cancel')
    expect(calls[0]!.body).toEqual({ cancellationReason: 'Đơn đã hủy' })
  })
})

describe('đặt mua qua cổng PayOS', () => {
  it('khách được chuyển tới checkoutUrl của PayOS, link gửi đi mang đúng mã đơn và tổng tiền', async () => {
    const { calls, gateway } = fakePayos(ok({ ...createdData, orderCode: 100000 }))
    const { checkout } = await shop({ gateway })

    const res = await checkout()

    expect(res.status).toBe(201)
    expect(res.body.checkoutUrl).toBe('https://pay.payos.vn/web/link-1')
    expect(calls[0]!.body).toMatchObject({ orderCode: 100000, amount: 2_030_000, description: 'DH100000' })
  })

  it('PayOS không trả lời khi tạo link thì đặt mua trả 502, không giữ hàng', async () => {
    const { gateway } = fakePayos(new TypeError('fetch failed'))
    const { checkout, request, token } = await shop({ gateway })

    const res = await checkout()

    expect(res.status).toBe(502)
    expect(res.body.error.code).toBe('BAD_GATEWAY')
    const stock = await request.get('/api/admin/stock').set(bearer(token))
    expect(stock.body.items.map((i: { reserved: number }) => i.reserved)).toEqual([0, 0])
  })

  it('PayOS trả mã lỗi khi tạo link thì đặt mua trả 502', async () => {
    const { gateway } = fakePayos(Response.json({ code: '20', desc: 'Thông tin truyền lên không đúng', data: null }))
    const { checkout } = await shop({ gateway })

    expect((await checkout()).status).toBe(502)
  })

  it('khách quay về trang kết quả: giao dịch PayOS trả về khi truy vấn được ghi nhận, đơn thành đã trả đủ', async () => {
    const paid = { ...linkInfo('PAID', [transaction]), orderCode: 100000 }
    const { calls, gateway } = fakePayos(ok({ ...createdData, orderCode: 100000 }), ok(paid))
    const { checkout, request } = await shop({ gateway })
    const placed = await checkout()

    const res = await request.get('/api/orders/100000').query({ token: placed.body.token, refresh: '1' })

    expect(calls[1]!.url).toBe('https://api-merchant.payos.vn/v2/payment-requests/100000')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
  })
})
