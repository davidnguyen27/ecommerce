import { z } from 'zod'
import { PROVINCES } from './provinces.generated.ts'

export { PROVINCES }

const PROVINCE_CODES: ReadonlySet<string> = new Set(PROVINCES.map((p) => p.code))

/** Mã tỉnh/thành hai chữ số theo danh mục hành chính áp dụng từ 01/07/2025, ví dụ `01` Hà Nội. */
export const ProvinceCode = z.string().refine((code) => PROVINCE_CODES.has(code), 'Tỉnh/thành không hợp lệ')

/** Tên ngắn của tỉnh/thành (`Hà Nội`); mã không có trong danh mục thì `undefined`. */
export function provinceName(code: string) {
  return PROVINCES.find((p) => p.code === code)?.name
}
