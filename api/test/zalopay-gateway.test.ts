import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ZaloPayPaymentGateway,
  appTransId,
  isValidZaloPayCallback,
  orderCodeFromAppTransId,
} from '../src/payments/zalopay.ts'
import { shop } from './support/shop.ts'
import { bearer } from './support/staff.ts'

// Khóa giả của test, không phải khóa sandbox hay khóa thật.
const KEYS = { appId: '9999', key1: 'test-key1', key2: 'test-key2', env: 'sandbox' as const }
const SANDBOX = 'https://sb-openapi.zalopay.vn'
/** 2026-11-02 10:00:00 giờ Việt Nam. */
const NOW = new Date('2026-11-02T03:00:00Z')

type Call = { url: string; method: string; contentType: string | null; form: Record<string, string> }

/** HTTP giả thay cho ZaloPay: ghi lại request (form), trả lần lượt các response đã xếp. */
function fakeZaloPay(
  options: { now?: () => Date; env?: 'sandbox' | 'production' },
  ...responses: (Response | Error)[]
) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      contentType: new Headers(init?.headers).get('content-type'),
      form: Object.fromEntries(new URLSearchParams(String(init?.body ?? '')).entries()),
    })
    const next = responses.shift()
    if (!next) throw new Error('Không còn response giả')
    if (next instanceof Error) throw next
    return next
  }
  const gateway = new ZaloPayPaymentGateway({
    ...KEYS,
    env: options.env ?? 'sandbox',
    callbackUrl: 'https://shop.test/api/payments/zalopay/callback',
    fetch,
    now: options.now,
  })
  return { calls, gateway }
}

const hmac = (text: string, key: string) => createHmac('sha256', key).update(text).digest('hex')

const created = (orderUrl = 'https://qcgateway.zalopay.vn/openinapp?order=abc') =>
  Response.json({
    return_code: 1,
    return_message: 'Giao dịch thành công',
    sub_return_code: 1,
    sub_return_message: 'Giao dịch thành công',
    zp_trans_token: 'abc',
    order_url: orderUrl,
    order_token: 'abc',
  })

const LINK = {
  orderCode: 100123,
  amount: 2_030_000,
  description: 'Thanh toán đơn hàng #100123',
  returnUrl: 'https://shop.test/don-hang/100123?ket-qua=1',
  expiresAt: new Date('2026-11-02T03:15:00Z'),
}

describe('mã đơn bên ZaloPay', () => {
  it('app_trans_id bắt đầu bằng yymmdd theo giờ Việt Nam, cả sát nửa đêm', () => {
    // 23:59 ngày 02/11 giờ Việt Nam là 16:59 UTC cùng ngày; 00:00 ngày 03/11 giờ Việt Nam là 17:00 UTC ngày 02/11.
    expect(appTransId(100123, new Date('2026-11-02T16:59:00Z'))).toBe('261102_100123')
    expect(appTransId(100123, new Date('2026-11-02T17:00:00Z'))).toBe('261103_100123')
    expect(appTransId(100123, new Date('2026-12-31T17:00:00Z'))).toBe('270101_100123')
  })

  it('đọc lại mã đơn từ app_trans_id; mã lạ thì không có', () => {
    expect(orderCodeFromAppTransId('261102_100123')).toBe(100123)
    expect(orderCodeFromAppTransId('100123')).toBeNull()
    expect(orderCodeFromAppTransId('261102_abc')).toBeNull()
  })

  it('MAC callback là HMAC-SHA256 bằng key2 trên chuỗi data', () => {
    const data = '{"app_trans_id":"261102_100123","amount":2030000}'
    expect(isValidZaloPayCallback(data, hmac(data, 'test-key2'), 'test-key2')).toBe(true)
    expect(isValidZaloPayCallback(data, hmac(data, 'test-key1'), 'test-key2')).toBe(false)
    expect(isValidZaloPayCallback(data, 'abc', 'test-key2')).toBe(false)
  })
})

describe('cổng ZaloPay', () => {
  it('tạo đơn gửi POST /v2/create đủ trường, MAC bằng key1, hạn khớp hạn giữ hàng, app_user là mã đơn', async () => {
    const { calls, gateway } = fakeZaloPay({ now: () => NOW }, created())

    const link = await gateway.createLink(LINK)

    expect(link).toEqual({
      checkoutUrl: 'https://qcgateway.zalopay.vn/openinapp?order=abc',
      gatewayReference: '261102_100123',
    })
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.method).toBe('POST')
    expect(call.url).toBe(`${SANDBOX}/v2/create`)
    expect(call.contentType).toBe('application/x-www-form-urlencoded')
    const embedData = '{"redirecturl":"https://shop.test/don-hang/100123?ket-qua=1"}'
    // Theo tài liệu: app_id|app_trans_id|app_user|amount|app_time|embed_data|item.
    const signed = `9999|261102_100123|100123|2030000|1793588400000|${embedData}|[]`
    expect(call.form).toEqual({
      app_id: '9999',
      app_trans_id: '261102_100123',
      app_user: '100123',
      app_time: '1793588400000',
      amount: '2030000',
      item: '[]',
      embed_data: embedData,
      description: 'Thanh toán đơn hàng #100123',
      bank_code: '',
      expire_duration_seconds: '900',
      callback_url: 'https://shop.test/api/payments/zalopay/callback',
      mac: hmac(signed, 'test-key1'),
    })
  })

  it('môi trường production gọi host thật', async () => {
    const { calls, gateway } = fakeZaloPay({ now: () => NOW, env: 'production' }, created())

    await gateway.createLink(LINK)

    expect(calls[0]!.url).toBe('https://openapi.zalopay.vn/v2/create')
  })

  it('hạn ngắn hơn 5 phút được nâng lên 300 giây, mức tối thiểu ZaloPay nhận', async () => {
    const { calls, gateway } = fakeZaloPay({ now: () => NOW }, created())

    await gateway.createLink({ ...LINK, expiresAt: new Date('2026-11-02T03:01:00Z') })

    expect(calls[0]!.form.expire_duration_seconds).toBe('300')
  })

  it('ZaloPay trả return_code khác 1 thì báo lỗi cổng kèm mã phụ', async () => {
    const { gateway } = fakeZaloPay(
      { now: () => NOW },
      Response.json({
        return_code: 2,
        return_message: 'Thất bại',
        sub_return_code: -68,
        sub_return_message: 'Trùng mã',
      }),
    )

    await expect(gateway.createLink(LINK)).rejects.toThrow('ZaloPay 2/-68: Trùng mã')
  })

  it('HTTP lỗi hay lỗi mạng thì báo lỗi cổng', async () => {
    const http = fakeZaloPay({ now: () => NOW }, new Response('Bad Gateway', { status: 502 }))
    const network = fakeZaloPay({ now: () => NOW }, new TypeError('fetch failed'))

    await expect(http.gateway.createLink(LINK)).rejects.toThrow('ZaloPay trả HTTP 502')
    await expect(network.gateway.createLink(LINK)).rejects.toThrow('ZaloPay: không gọi được API')
  })

  it('truy vấn gửi POST /v2/query với MAC bằng key1 trên app_id|app_trans_id|key1; đã trả thì có một giao dịch', async () => {
    const body = {
      return_code: 1,
      return_message: 'Giao dịch thành công',
      sub_return_code: 1,
      sub_return_message: 'Giao dịch thành công',
      is_processing: false,
      amount: 2_030_000,
      discount_amount: 0,
      zp_trans_id: 251102000000123,
      server_time: 1793589330000,
    }
    const { calls, gateway } = fakeZaloPay({ now: () => NOW }, Response.json(body))

    const info = await gateway.getPayment('261102_100123')

    expect(calls[0]!.url).toBe(`${SANDBOX}/v2/query`)
    expect(calls[0]!.form).toEqual({
      app_id: '9999',
      app_trans_id: '261102_100123',
      mac: hmac('9999|261102_100123|test-key1', 'test-key1'),
    })
    expect(info).toEqual({
      status: 'paid',
      transactions: [
        { reference: '251102000000123', amount: 2_030_000, paidAt: new Date('2026-11-02T03:15:30Z'), payload: body },
      ],
    })
  })

  it.each([
    [2, 'failed'],
    [3, 'pending'],
  ])('truy vấn return_code %s thành %s, không có giao dịch', async (returnCode, status) => {
    const { gateway } = fakeZaloPay({}, Response.json({ return_code: returnCode, is_processing: false }))

    expect(await gateway.getPayment('261102_100123')).toEqual({ status, transactions: [] })
  })

  it('truy vấn return_code lạ thì báo lỗi cổng thay vì đoán', async () => {
    const { gateway } = fakeZaloPay({}, Response.json({ return_code: -401, return_message: 'Sai MAC' }))

    await expect(gateway.getPayment('261102_100123')).rejects.toThrow('ZaloPay -401')
  })

  it('hủy link không gọi ZaloPay (không có API hủy đơn)', async () => {
    const { calls, gateway } = fakeZaloPay({})

    await gateway.cancelLink()

    expect(calls).toEqual([])
  })
})

describe('đặt mua qua cổng ZaloPay', () => {
  it('khách được chuyển tới order_url, đơn gửi đi mang đúng mã đơn, tổng tiền và mô tả', async () => {
    const { calls, gateway } = fakeZaloPay({}, created('https://qcgateway.zalopay.vn/openinapp?order=xyz'))
    const { checkout } = await shop({ gateway })

    const res = await checkout()

    expect(res.status).toBe(201)
    expect(res.body.checkoutUrl).toBe('https://qcgateway.zalopay.vn/openinapp?order=xyz')
    expect(calls[0]!.form).toMatchObject({
      app_user: '100000',
      amount: '2030000',
      description: 'Thanh toán đơn hàng #100000',
      expire_duration_seconds: '900',
    })
    expect(calls[0]!.form.app_trans_id).toMatch(/^\d{6}_100000$/)
    // Không gửi email hay số điện thoại khách cho cổng.
    expect(JSON.stringify(calls[0]!.form)).not.toMatch(/example\.com|0912345678/i)
  })

  it('lỗi mạng hay ZaloPay báo lỗi khi tạo đơn thì đặt mua trả 502, không giữ hàng', async () => {
    const network = fakeZaloPay({}, new TypeError('fetch failed'))
    const refused = fakeZaloPay({}, Response.json({ return_code: 2, sub_return_code: -68 }))

    for (const { gateway } of [network, refused]) {
      const { checkout, request, token } = await shop({ gateway })
      const res = await checkout()
      expect(res.status).toBe(502)
      expect(res.body.error.code).toBe('BAD_GATEWAY')
      const stock = await request.get('/api/admin/stock').set(bearer(token))
      expect(stock.body.items.map((i: { reserved: number }) => i.reserved)).toEqual([0, 0])
    }
  })

  it('khách quay về trang kết quả: truy vấn bằng mã đã lưu khi đặt, khoản đã trả được ghi nhận', async () => {
    const paid = { return_code: 1, amount: 2_030_000, zp_trans_id: 251102000000001, server_time: 1793589330000 }
    const { calls, gateway } = fakeZaloPay({}, created(), Response.json(paid))
    const { checkout, request } = await shop({ gateway })
    const placed = await checkout()

    const res = await request.get('/api/orders/100000').query({ token: placed.body.token, refresh: '1' })

    expect(calls[1]!.url).toBe(`${SANDBOX}/v2/query`)
    expect(calls[1]!.form.app_trans_id).toBe(calls[0]!.form.app_trans_id)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
  })
})
