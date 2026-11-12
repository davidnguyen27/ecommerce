import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  VnpayPaymentGateway,
  asciiOrderInfo,
  isValidVnpaySignature,
  parseTxnRef,
  parseVnDateTime,
  txnRef,
  vnDateTime,
} from '../src/payments/vnpay.ts'
import { shop } from './support/shop.ts'
import { signedIpn } from './support/vnpay.ts'

// Khóa giả của test, không phải khóa sandbox hay khóa thật.
const KEYS = { tmnCode: 'TESTTMN1', hashSecret: 'test-secret', env: 'sandbox' as const }
const PAY_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'
const API_URL = 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'
/** 2026-11-02 10:00:00 giờ Việt Nam. */
const NOW = new Date('2026-11-02T03:00:00Z')
const REF = '100123T20261102100000'

const sha512 = (text: string, key: string) => createHmac('sha512', key).update(text).digest('hex')

type Call = { url: string; method: string; contentType: string | null; body: Record<string, string> }

/** HTTP giả thay cho API giao dịch VNPAY: ghi lại request (JSON), trả lần lượt các response đã xếp. */
function fakeVnpay(options: { now?: () => Date; env?: 'sandbox' | 'production' }, ...responses: (Response | Error)[]) {
  const calls: Call[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      contentType: new Headers(init?.headers).get('content-type'),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, string>,
    })
    const next = responses.shift()
    if (!next) throw new Error('Không còn response giả')
    if (next instanceof Error) throw next
    return next
  }
  const gateway = new VnpayPaymentGateway({
    ...KEYS,
    env: options.env ?? 'sandbox',
    serverIp: '10.0.0.1',
    fetch,
    now: options.now ?? (() => NOW),
    requestId: () => 'req-1',
  })
  /** Xếp thêm response sau khi đã tạo cổng. */
  const respond = (...more: (Response | Error)[]) => void responses.push(...more)
  return { calls, gateway, respond }
}

/** Response truy vấn như VNPAY trả, ký theo chuỗi `|` của tài liệu (tính độc lập với code đang test). */
function queryResponse(fields: Record<string, string>, secret = KEYS.hashSecret) {
  const body: Record<string, string> = {
    vnp_ResponseId: 'resp-1',
    vnp_Command: 'querydr',
    vnp_ResponseCode: '00',
    vnp_Message: 'QueryDR Success',
    vnp_TmnCode: KEYS.tmnCode,
    vnp_TxnRef: REF,
    vnp_Amount: '203000000',
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20261102101530',
    vnp_TransactionNo: '14000123',
    vnp_TransactionType: '01',
    vnp_TransactionStatus: '00',
    vnp_OrderInfo: 'Thanh toan don hang 100123',
    vnp_PromotionCode: '',
    vnp_PromotionAmount: '',
    ...fields,
  }
  const signed = [
    body.vnp_ResponseId,
    body.vnp_Command,
    body.vnp_ResponseCode,
    body.vnp_Message,
    body.vnp_TmnCode,
    body.vnp_TxnRef,
    body.vnp_Amount,
    body.vnp_BankCode,
    body.vnp_PayDate,
    body.vnp_TransactionNo,
    body.vnp_TransactionType,
    body.vnp_TransactionStatus,
    body.vnp_OrderInfo,
    body.vnp_PromotionCode,
    body.vnp_PromotionAmount,
  ].join('|')
  return Response.json({ ...body, vnp_SecureHash: sha512(signed, secret) })
}

const LINK = {
  orderCode: 100123,
  amount: 2_030_000,
  description: 'Thanh toán đơn hàng #100123',
  returnUrl: 'https://shop.test/don-hang/100123?ket-qua=1',
  expiresAt: new Date('2026-11-02T03:15:00Z'),
  clientIp: '203.0.113.5',
}

describe('định dạng của VNPAY', () => {
  it('ngày giờ yyyyMMddHHmmss theo giờ Việt Nam, cả sát nửa đêm, đọc ngược lại được', () => {
    // 23:59:59 ngày 02/11 giờ Việt Nam là 16:59:59 UTC; 00:00 ngày 03/11 giờ Việt Nam là 17:00 UTC ngày 02/11.
    expect(vnDateTime(new Date('2026-11-02T16:59:59Z'))).toBe('20261102235959')
    expect(vnDateTime(new Date('2026-11-02T17:00:00Z'))).toBe('20261103000000')
    expect(parseVnDateTime('20261103000000')).toEqual(new Date('2026-11-02T17:00:00Z'))
    expect(parseVnDateTime('2026-11-03')).toBeNull()
  })

  it('vnp_TxnRef ghép mã đơn với giờ tạo: cùng mã đơn tạo lại lúc khác thì khác mã; đọc ngược lại được', () => {
    expect(txnRef(100123, NOW)).toBe(REF)
    expect(txnRef(100123, new Date(NOW.getTime() + 1_000))).not.toBe(REF)
    expect(parseTxnRef(REF)).toEqual({ orderCode: 100123, createDate: '20261102100000' })
    expect(parseTxnRef('100123')).toBeNull()
    expect(parseTxnRef('abcT20261102100000')).toBeNull()
  })

  it('vnp_OrderInfo không dấu, không ký tự đặc biệt', () => {
    expect(asciiOrderInfo('Thanh toán đơn hàng #100123')).toBe('Thanh toan don hang 100123')
    expect(asciiOrderInfo('Đặt   mua: Ưu đãi!')).toBe('Dat mua Uu dai')
  })

  it('chữ ký IPN là HMAC-SHA512 trên tham số đã sắp và encode, bỏ vnp_SecureHash/vnp_SecureHashType', () => {
    const params = { vnp_TxnRef: REF, vnp_OrderInfo: 'Thanh toan don hang', vnp_Amount: '203000000' }
    const signed = signedIpn(params, KEYS.hashSecret)
    expect(isValidVnpaySignature(signed, KEYS.hashSecret)).toBe(true)
    expect(isValidVnpaySignature({ ...signed, vnp_SecureHashType: 'HmacSHA512' }, KEYS.hashSecret)).toBe(true)
    expect(isValidVnpaySignature({ ...signed, vnp_Amount: '1' }, KEYS.hashSecret)).toBe(false)
    expect(isValidVnpaySignature(signed, 'khac')).toBe(false)
    expect(isValidVnpaySignature({ ...signed, vnp_SecureHash: ['a', 'b'] }, KEYS.hashSecret)).toBe(false)
  })
})

describe('cổng VNPAY: link thanh toán', () => {
  it('URL ký sẵn tới trang VNPAY, đủ tham số tài liệu đòi, không gọi mạng', async () => {
    const { calls, gateway } = fakeVnpay({})

    const link = await gateway.createLink(LINK)

    expect(calls).toHaveLength(0)
    expect(link.gatewayReference).toBe(REF)
    const url = new URL(link.checkoutUrl)
    expect(`${url.origin}${url.pathname}`).toBe(PAY_URL)
    const params = Object.fromEntries(url.searchParams)
    expect(params).toEqual({
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: 'TESTTMN1',
      vnp_Amount: '203000000',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: REF,
      vnp_OrderInfo: 'Thanh toan don hang 100123',
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: 'https://shop.test/don-hang/100123?ket-qua=1',
      vnp_IpAddr: '203.0.113.5',
      vnp_CreateDate: '20261102100000',
      vnp_ExpireDate: '20261102101500',
      vnp_SecureHash: expect.stringMatching(/^[0-9a-f]{128}$/),
    })
    // Chữ ký tính độc lập theo tài liệu: các tham số trừ chữ ký, sắp theo tên, encode kiểu PHP (khoảng trắng là +).
    const { vnp_SecureHash, ...rest } = params
    const data = Object.keys(rest)
      .sort()
      .map((key) => `${key}=${encodeURIComponent(rest[key]!).replace(/%20/g, '+')}`)
      .join('&')
    expect(vnp_SecureHash).toBe(sha512(data, KEYS.hashSecret))
    // Query của URL chính là chuỗi đã ký.
    expect(link.checkoutUrl).toContain(`?${data}&vnp_SecureHash=`)
  })

  it('môi trường production dùng trang thanh toán thật', async () => {
    const { gateway } = fakeVnpay({ env: 'production' })

    const link = await gateway.createLink(LINK)

    expect(link.checkoutUrl.startsWith('https://pay.vnpay.vn/vpcpay.html?')).toBe(true)
  })
})

describe('cổng VNPAY: truy vấn', () => {
  it('gửi querydr JSON, chữ ký nối bằng |, giờ giao dịch đọc từ vnp_TxnRef', async () => {
    const { calls, gateway } = fakeVnpay({}, queryResponse({}))

    await gateway.getPayment(REF)

    const call = calls[0]!
    expect(call.url).toBe(API_URL)
    expect(call.method).toBe('POST')
    expect(call.contentType).toBe('application/json')
    expect(call.body).toEqual({
      vnp_RequestId: 'req-1',
      vnp_Version: '2.1.0',
      vnp_Command: 'querydr',
      vnp_TmnCode: 'TESTTMN1',
      vnp_TxnRef: REF,
      vnp_OrderInfo: 'Truy van don 100123',
      vnp_TransactionDate: '20261102100000',
      vnp_CreateDate: '20261102100000',
      vnp_IpAddr: '10.0.0.1',
      vnp_SecureHash: sha512(
        `req-1|2.1.0|querydr|TESTTMN1|${REF}|20261102100000|20261102100000|10.0.0.1|Truy van don 100123`,
        KEYS.hashSecret,
      ),
    })
  })

  it('đã trả: một giao dịch, số tiền chia 100, mã là vnp_TransactionNo, giờ là vnp_PayDate', async () => {
    const { gateway } = fakeVnpay({}, queryResponse({}))

    const info = await gateway.getPayment(REF)

    expect(info.status).toBe('paid')
    expect(info.transactions).toEqual([
      {
        reference: '14000123',
        amount: 2_030_000,
        paidAt: new Date('2026-11-02T03:15:30Z'),
        payload: expect.objectContaining({ vnp_TxnRef: REF }),
      },
    ])
  })

  it.each([
    ['chưa có giao dịch (91)', { vnp_ResponseCode: '91' }, 'pending'],
    ['chưa hoàn tất (01)', { vnp_TransactionStatus: '01' }, 'pending'],
    ['giao dịch lỗi (02)', { vnp_TransactionStatus: '02' }, 'failed'],
  ] as const)('%s', async (_, fields, status) => {
    const { gateway } = fakeVnpay({}, queryResponse(fields))

    expect(await gateway.getPayment(REF)).toEqual({ status, transactions: [] })
  })

  it('response sai chữ ký, mã lỗi, lỗi mạng hay mã giao dịch lạ đều thành lỗi cổng', async () => {
    const forged = fakeVnpay({}, queryResponse({}, 'khoa-khac'))
    const refused = fakeVnpay({}, queryResponse({ vnp_ResponseCode: '97', vnp_Message: 'Invalid Checksum' }))
    const network = fakeVnpay({}, new TypeError('fetch failed'))
    const http = fakeVnpay({}, new Response('down', { status: 503 }))

    await expect(forged.gateway.getPayment(REF)).rejects.toThrow('sai chữ ký')
    await expect(refused.gateway.getPayment(REF)).rejects.toThrow('VNPAY querydr 97')
    await expect(network.gateway.getPayment(REF)).rejects.toThrow('không gọi được API')
    await expect(http.gateway.getPayment(REF)).rejects.toThrow('HTTP 503')
    await expect(fakeVnpay({}).gateway.getPayment('100123')).rejects.toThrow('mã giao dịch lạ')
  })
})

describe('đặt mua qua cổng VNPAY', () => {
  it('khách được chuyển tới trang VNPAY với đúng mã đơn, tổng tiền, hạn giữ hàng; không lộ thông tin khách', async () => {
    const { gateway } = fakeVnpay({ now: () => new Date() })
    const { checkout } = await shop({ gateway })

    const res = await checkout()

    expect(res.status).toBe(201)
    const url = new URL(res.body.checkoutUrl)
    expect(`${url.origin}${url.pathname}`).toBe(PAY_URL)
    expect(url.searchParams.get('vnp_TxnRef')).toMatch(/^100000T\d{14}$/)
    expect(url.searchParams.get('vnp_Amount')).toBe('203000000')
    expect(url.searchParams.get('vnp_OrderInfo')).toBe('Thanh toan don hang 100000')
    expect(url.searchParams.get('vnp_IpAddr')).toMatch(/^[\d.:a-f]+$/)
    const created = parseVnDateTime(url.searchParams.get('vnp_CreateDate')!)!
    const expires = parseVnDateTime(url.searchParams.get('vnp_ExpireDate')!)!
    expect(expires.getTime() - created.getTime()).toBeGreaterThanOrEqual(14 * 60_000)
    // Không gửi email hay số điện thoại khách cho cổng.
    expect(res.body.checkoutUrl).not.toMatch(/example\.com|0912345678/i)
  })

  it('khách quay về trang kết quả: truy vấn bằng mã đã lưu khi đặt, khoản đã trả được ghi nhận', async () => {
    const { calls, gateway, respond } = fakeVnpay({ now: () => new Date() })
    const { checkout, request } = await shop({ gateway })
    const placed = await checkout()
    const ref = new URL(placed.body.checkoutUrl).searchParams.get('vnp_TxnRef')!
    respond(queryResponse({ vnp_TxnRef: ref, vnp_OrderInfo: 'Thanh toan don hang 100000' }))

    const res = await request.get('/api/orders/100000').query({ token: placed.body.token, refresh: '1' })

    expect(calls[0]!.body.vnp_TxnRef).toBe(ref)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'processing', paymentStatus: 'paid' })
  })
})
