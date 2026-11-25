import { depositFor, shippingFeeFor } from '@ecommerce/shared'

type ShippingConfig = Parameters<typeof shippingFeeFor>[0]

/** A number once the province (or deposit percent) is known, otherwise `null`. */
type Known<T, Given> = [T] extends [Given] ? number : number | null

/**
 * Shipping fee, total and deposit from goods and discount. The free-shipping threshold and the deposit both use goods
 * after discount (spec M5). Shared by quotes and placement so the quote matches the order; use `discount: 0` for the
 * "without voucher" figures. No `provinceCode` gives `null` fee and total; no `depositPercent` gives `null` deposit.
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
