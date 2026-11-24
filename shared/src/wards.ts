/**
 * Separate entry `@ecommerce/shared/wards`: the 3,321 wards weigh about 120 KB, so they are not in the main export
 * every web page loads. The web imports it dynamically on checkout only; the API imports it directly to validate
 * addresses.
 */
import { WARDS_BY_PROVINCE } from './wards.generated.ts'

export type Ward = { code: string; name: string }

/** Wards of a province, by code; unknown province codes give an empty list. */
export function wardsOf(provinceCode: string): Ward[] {
  return (WARDS_BY_PROVINCE[provinceCode] ?? []).map(([code, name]) => ({ code, name }))
}

/** Full ward name (`Phường Ba Đình`) if it belongs to that province; otherwise `undefined`. */
export function wardName(provinceCode: string, wardCode: string) {
  return WARDS_BY_PROVINCE[provinceCode]?.find(([code]) => code === wardCode)?.[1]
}

/** A province–ward pair in the list, with the ward belonging to that province. */
export function isValidWard(provinceCode: string, wardCode: string) {
  return wardName(provinceCode, wardCode) !== undefined
}
