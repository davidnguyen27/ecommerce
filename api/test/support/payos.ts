import { createHmac } from 'node:crypto'
import { PAYOS_CHECKSUM_KEY } from './test-app.ts'

/** Dữ liệu webhook PayOS cho một khoản chuyển khoản thành công; `data` ghi đè từng trường. */
export function webhookData(orderCode: number, amount: number, data: Record<string, unknown> = {}) {
  return {
    orderCode,
    amount,
    description: `DH${orderCode}`,
    accountNumber: '12345678',
    reference: `FT${orderCode}A`,
    transactionDateTime: '2026-11-02 10:15:30',
    currency: 'VND',
    paymentLinkId: `link-${orderCode}`,
    code: '00',
    desc: 'success',
    counterAccountBankId: '',
    counterAccountBankName: '',
    counterAccountName: null,
    counterAccountNumber: null,
    virtualAccountName: null,
    virtualAccountNumber: '',
    ...data,
  }
}

/**
 * Body webhook như PayOS gửi, ký bằng checksum key của test: HMAC-SHA256 trên `key=value` của `data`
 * xếp theo alphabet, nối bằng `&`, `null` thành chuỗi rỗng. Viết riêng ở đây để không ký bằng chính code đang test.
 */
export function signedWebhook(data: Record<string, unknown>, key = PAYOS_CHECKSUM_KEY) {
  const text = Object.keys(data)
    .sort()
    .map((k) => `${k}=${data[k] === null || data[k] === undefined ? '' : String(data[k])}`)
    .join('&')
  const signature = createHmac('sha256', key).update(text).digest('hex')
  return { code: '00', desc: 'success', success: true, data, signature }
}

/**
 * Chữ ký PayOS đặt trên `data` của response API, như SDK `@payos/node` kiểm: `key=value` theo alphabet,
 * mảng thành JSON với key mỗi phần tử theo alphabet, `null` thành rỗng.
 */
export function payosResponseSignature(data: Record<string, unknown>, key: string) {
  const sorted = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)))
  const text = Object.keys(data)
    .sort()
    .map((k) => {
      const v = data[k]
      if (Array.isArray(v)) return `${k}=${JSON.stringify(v.map((item) => sorted(item as Record<string, unknown>)))}`
      return `${k}=${v === null || v === undefined ? '' : String(v)}`
    })
    .join('&')
  return createHmac('sha256', key).update(text).digest('hex')
}
