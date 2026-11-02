/**
 * Entry riêng `@ecommerce/shared/wards`: danh sách 3321 phường/xã nặng khoảng 120 KB, nên không nằm trong export chính
 * mà mọi trang web đều nạp. Web chỉ import động ở trang đặt mua; API import thẳng để kiểm địa chỉ.
 */
import { WARDS_BY_PROVINCE } from './wards.generated.ts'

export type Ward = { code: string; name: string }

/** Phường/xã của một tỉnh/thành, theo mã; mã tỉnh không có trong danh mục thì rỗng. */
export function wardsOf(provinceCode: string): Ward[] {
  return (WARDS_BY_PROVINCE[provinceCode] ?? []).map(([code, name]) => ({ code, name }))
}

/** Tên đầy đủ của phường/xã (`Phường Ba Đình`) nếu nó thuộc đúng tỉnh/thành đó; không thì `undefined`. */
export function wardName(provinceCode: string, wardCode: string) {
  return WARDS_BY_PROVINCE[provinceCode]?.find(([code]) => code === wardCode)?.[1]
}

/** Cặp tỉnh/thành – phường/xã có trong danh mục, và phường/xã thuộc đúng tỉnh/thành đó. */
export function isValidWard(provinceCode: string, wardCode: string) {
  return wardName(provinceCode, wardCode) !== undefined
}
