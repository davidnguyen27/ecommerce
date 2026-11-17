import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PaymentGatewayError, type RefundRequest } from '../src/payments/gateway.ts'
import { VnpayPaymentGateway, refundOutcome } from '../src/payments/vnpay.ts'

// Khóa giả của test, không phải khóa sandbox hay khóa thật.
const KEYS = { tmnCode: 'TESTTMN1', hashSecret: 'test-secret', env: 'sandbox' as const }
const API_URL = 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'
/** 2026-11-17 10:00:00 giờ Việt Nam. */
const NOW = new Date('2026-11-17T03:00:00Z')
const REF = '100123T20261110093000'

const sha512 = (text: string) => createHmac('sha512', KEYS.hashSecret).update(text).digest('hex')

/** Lệnh hoàn mẫu: giao dịch gốc 2.030.000 đã về qua trang quay về, mang `vnp_TxnRef` trong payload. */
const request = (overrides: Partial<RefundRequest> = {}): RefundRequest => ({
  refundId: '0b8f5a52-3d1c-4c55-9a43-6c0d2f6f1a10',
  orderCode: 100123,
  amount: 2_030_000,
  full: true,
  createdBy: 'a1b2c3d4-0000-4000-8000-000000000001',
  transaction: { reference: '14512345', amount: 2_030_000, source: 'return', payload: { vnp_TxnRef: REF } },
  ...overrides,
})

/** Response hoàn tiền như VNPAY trả, ký theo chuỗi `|` của tài liệu (tính độc lập với code đang test). */
function refundResponse(fields: Record<string, string>, sign = true) {
  const body: Record<string, string> = {
    vnp_ResponseId: 'resp-1',
    vnp_Command: 'refund',
    vnp_ResponseCode: '00',
    vnp_Message: 'Refund success',
    vnp_TmnCode: KEYS.tmnCode,
    vnp_TxnRef: REF,
    vnp_Amount: '203000000',
    vnp_BankCode: 'NCB',
    vnp_PayDate: '20261117100001',
    vnp_TransactionNo: '14599999',
    vnp_TransactionType: '02',
    vnp_TransactionStatus: '00',
    vnp_OrderInfo: 'Hoan tien don 100123',
    ...fields,
  }
  const order = [
    'vnp_ResponseId',
    'vnp_Command',
    'vnp_ResponseCode',
    'vnp_Message',
    'vnp_TmnCode',
    'vnp_TxnRef',
    'vnp_Amount',
    'vnp_BankCode',
    'vnp_PayDate',
    'vnp_TransactionNo',
    'vnp_TransactionType',
    'vnp_TransactionStatus',
    'vnp_OrderInfo',
  ]
  if (sign) body.vnp_SecureHash = sha512(order.map((k) => body[k] ?? '').join('|'))
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function fakeVnpay(...responses: (Response | Error)[]) {
  const calls: { url: string; body: Record<string, string> }[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, string> })
    const next = responses.shift()
    if (!next) throw new Error('Không còn response giả')
    if (next instanceof Error) throw next
    return next
  }
  const gateway = new VnpayPaymentGateway({ ...KEYS, serverIp: '10.0.0.1', fetch, now: () => NOW })
  return { calls, gateway }
}

describe('lệnh hoàn VNPAY', () => {
  it('gửi đúng trường và ký chuỗi `|` theo thứ tự tài liệu bằng HMAC-SHA512', async () => {
    const { calls, gateway } = fakeVnpay(refundResponse({}))

    const result = await gateway.refund(request())

    expect(result.status).toBe('succeeded')
    expect(calls).toHaveLength(1)
    const { url, body } = calls[0]!
    expect(url).toBe(API_URL)
    expect(body).toMatchObject({
      vnp_RequestId: '0b8f5a523d1c4c559a436c0d2f6f1a10',
      vnp_Version: '2.1.0',
      vnp_Command: 'refund',
      vnp_TmnCode: KEYS.tmnCode,
      vnp_TransactionType: '02',
      vnp_TxnRef: REF,
      vnp_Amount: '203000000',
      vnp_TransactionNo: '14512345',
      vnp_TransactionDate: '20261110093000',
      vnp_CreateBy: 'a1b2c3d4000040008000000000000001',
      vnp_CreateDate: '20261117100000',
      vnp_IpAddr: '10.0.0.1',
      vnp_OrderInfo: 'Hoan tien don 100123',
    })
    const signed = [
      'vnp_RequestId',
      'vnp_Version',
      'vnp_Command',
      'vnp_TmnCode',
      'vnp_TransactionType',
      'vnp_TxnRef',
      'vnp_Amount',
      'vnp_TransactionNo',
      'vnp_TransactionDate',
      'vnp_CreateBy',
      'vnp_CreateDate',
      'vnp_IpAddr',
      'vnp_OrderInfo',
    ]
      .map((k) => body[k])
      .join('|')
    expect(body.vnp_SecureHash).toBe(sha512(signed))
  })

  it('hoàn một phần dùng loại 03', async () => {
    const { calls, gateway } = fakeVnpay(refundResponse({ vnp_TransactionType: '03', vnp_Amount: '100000000' }))

    await gateway.refund(request({ amount: 1_000_000, full: false }))

    expect(calls[0]!.body).toMatchObject({ vnp_TransactionType: '03', vnp_Amount: '100000000' })
  })

  it('ánh xạ kết quả: 00/00 đã hoàn; 00/05, 00/06, 94 đang xử lý; mã khác bị từ chối', () => {
    expect(refundOutcome({ vnp_ResponseCode: '00', vnp_TransactionStatus: '00' })).toBe('succeeded')
    expect(refundOutcome({ vnp_ResponseCode: '00', vnp_TransactionStatus: '05' })).toBe('processing')
    expect(refundOutcome({ vnp_ResponseCode: '00', vnp_TransactionStatus: '06' })).toBe('processing')
    expect(refundOutcome({ vnp_ResponseCode: '94' })).toBe('processing')
    expect(refundOutcome({ vnp_ResponseCode: '00', vnp_TransactionStatus: '09' })).toBe('rejected')
    expect(refundOutcome({ vnp_ResponseCode: '95' })).toBe('rejected')
    expect(refundOutcome({ vnp_ResponseCode: '99' })).toBe('rejected')
  })

  it('mã lỗi trả về bị từ chối kèm lý do, không cần chữ ký', async () => {
    const { gateway } = fakeVnpay(refundResponse({ vnp_ResponseCode: '99', vnp_Message: 'Unexpected error' }, false))

    const result = await gateway.refund(request())

    expect(result).toMatchObject({ status: 'rejected', message: expect.stringContaining('99') })
  })

  it('response 00 sai chữ ký, HTTP lỗi hay mạng lỗi thì ném PaymentGatewayError', async () => {
    const wrong = refundResponse({})
    const body = { ...(await wrong.clone().json()), vnp_TransactionStatus: '00', vnp_Amount: '1' }
    const { gateway } = fakeVnpay(
      new Response(JSON.stringify(body), { status: 200 }),
      new Response('lỗi', { status: 502 }),
      new Error('ECONNRESET'),
    )

    await expect(gateway.refund(request())).rejects.toBeInstanceOf(PaymentGatewayError)
    await expect(gateway.refund(request())).rejects.toBeInstanceOf(PaymentGatewayError)
    await expect(gateway.refund(request())).rejects.toBeInstanceOf(PaymentGatewayError)
  })

  it('chỉ hoàn được giao dịch có vnp_TxnRef, không hoàn giao dịch giả lập', async () => {
    const { gateway, calls } = fakeVnpay()
    const t = request().transaction

    expect(gateway.canRefund(t)).toBe(true)
    expect(gateway.canRefund({ ...t, source: 'simulator' })).toBe(false)
    expect(gateway.canRefund({ ...t, payload: { reference: 'x' } })).toBe(false)
    await expect(gateway.refund(request({ transaction: { ...t, payload: {} } }))).rejects.toBeInstanceOf(
      PaymentGatewayError,
    )
    expect(calls).toHaveLength(0)
  })
})
