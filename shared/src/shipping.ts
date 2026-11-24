import { z } from 'zod'
import { ProvinceCode } from './regions.ts'

/** VND amount, non-negative integer. */
const Vnd = z.number().int().min(0).max(1_000_000_000)

export const ProvinceShippingFee = z.object({ provinceCode: ProvinceCode, fee: Vnd })
export type ProvinceShippingFee = z.infer<typeof ProvinceShippingFee>

/**
 * Shipping config as the admin page reads it. `defaultFee` is `null` when unset: the shop then takes no orders.
 * `provinceFees` sorted by province code.
 */
export const ShippingFeeConfig = z.object({
  defaultFee: Vnd.nullable(),
  /** Goods total at or above this ships free; `null` means no free shipping. */
  freeShippingThreshold: Vnd.nullable(),
  provinceFees: z.array(ProvinceShippingFee),
})
export type ShippingFeeConfig = z.infer<typeof ShippingFeeConfig>

/**
 * Body of `PUT /api/admin/shipping-fees`: replaces the whole config; default fee required, at most one fee per
 * province.
 */
export const ShippingFeeConfigRequest = z.object({
  defaultFee: Vnd,
  freeShippingThreshold: Vnd.nullable(),
  provinceFees: z
    .array(ProvinceShippingFee)
    .max(100)
    .superRefine((fees, ctx) => {
      const seen = new Set<string>()
      fees.forEach((fee, index) => {
        if (seen.has(fee.provinceCode)) {
          ctx.addIssue({ code: 'custom', path: [index, 'provinceCode'], message: 'Tỉnh/thành này đã có mức riêng' })
        }
        seen.add(fee.provinceCode)
      })
    }),
})
export type ShippingFeeConfigRequest = z.infer<typeof ShippingFeeConfigRequest>

/**
 * An order's shipping fee: the province fee beats the default; goods at or above the free threshold give 0. Call only
 * once a default fee exists.
 */
export function shippingFeeFor(
  config: { defaultFee: number; freeShippingThreshold: number | null; provinceFees: readonly ProvinceShippingFee[] },
  provinceCode: string,
  subtotal: number,
) {
  if (config.freeShippingThreshold !== null && subtotal >= config.freeShippingThreshold) return 0
  return config.provinceFees.find((f) => f.provinceCode === provinceCode)?.fee ?? config.defaultFee
}
