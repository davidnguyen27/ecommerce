import { createHmac, timingSafeEqual } from 'node:crypto'

const sortKeys = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, value[key]]),
  )

function fieldText(value: unknown): string {
  if (value === null || value === undefined || value === 'null' || value === 'undefined') return ''
  // Như SDK chính thức: mảng thành JSON, mỗi phần tử object có key xếp alphabet.
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((v) => (v && typeof v === 'object' ? sortKeys(v as Record<string, unknown>) : v)))
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Chữ ký PayOS của `data`: HMAC-SHA256 (hex) trên `key=value` xếp theo alphabet, nối bằng `&`; `null` thành rỗng. */
export function payosSignature(data: Record<string, unknown>, checksumKey: string) {
  const text = Object.keys(data)
    .sort()
    .map((key) => `${key}=${fieldText(data[key])}`)
    .join('&')
  return createHmac('sha256', checksumKey).update(text).digest('hex')
}

/** Webhook có đúng chữ ký của PayOS không; so sánh thời gian hằng. */
export function isValidPayosSignature(data: Record<string, unknown>, signature: string, checksumKey: string) {
  const expected = Buffer.from(payosSignature(data, checksumKey), 'hex')
  const actual = Buffer.from(signature, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** PayOS gửi giờ Việt Nam không kèm múi giờ, dạng `2026-11-02 10:15:30`; không đọc được thì `null`. */
export function parsePayosDateTime(text: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(text)
  if (!match) return null
  const date = new Date(`${match[1]}T${match[2]}+07:00`)
  return Number.isNaN(date.getTime()) ? null : date
}
