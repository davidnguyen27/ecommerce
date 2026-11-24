import { z } from 'zod'
import { PROVINCES } from './provinces.generated.ts'

export { PROVINCES }

const PROVINCE_CODES: ReadonlySet<string> = new Set(PROVINCES.map((p) => p.code))

/** Two-digit province code per the administrative list in force from 01/07/2025, e.g. `01` Hà Nội. */
export const ProvinceCode = z.string().refine((code) => PROVINCE_CODES.has(code), 'Tỉnh/thành không hợp lệ')

/** Short province name (`Hà Nội`); `undefined` for codes not in the list. */
export function provinceName(code: string) {
  return PROVINCES.find((p) => p.code === code)?.name
}
