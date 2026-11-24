import { depositFor, shippingFeeFor } from '@ecommerce/shared'

type ShippingConfig = Parameters<typeof shippingFeeFor>[0]

/** Số tiền khi đã biết tỉnh/thành (hay mức cọc), `null` khi chưa. */
type Known<T, Given> = [T] extends [Given] ? number : number | null

/**
 * Phí giao, tổng và tiền cọc của một đơn từ tiền hàng và tiền giảm (spec M5): ngưỡng miễn phí giao so với tiền hàng
 * sau giảm, và tiền cọc tính trên tiền hàng sau giảm. Báo giá và tạo đơn dùng chung hàm này nên số khách thấy lúc báo
 * giá khớp số trên đơn. Tính giá trị "không mã" thì gọi với `discount: 0`.
 *
 * Chưa có `provinceCode` thì phí giao và tổng là `null`; không có `depositPercent` (đơn hàng sẵn) thì tiền cọc là `null`.
 */
export function priceOrder<P extends string | undefined, D extends number | undefined>(
  config: ShippingConfig,
  input: { subtotal: number; discount: number; provinceCode?: P; depositPercent?: D },
): { shippingFee: Known<P, string>; total: Known<P, string>; depositAmount: Known<D, number> } {
  const goods = input.subtotal - input.discount
  const shippingFee = input.provinceCode === undefined ? null : shippingFeeFor(config, input.provinceCode, goods)
  return {
    shippingFee: shippingFee as Known<P, string>,
    total: (shippingFee === null ? null : goods + shippingFee) as Known<P, string>,
    depositAmount: (input.depositPercent === undefined ? null : depositFor(goods, input.depositPercent)) as Known<
      D,
      number
    >,
  }
}
