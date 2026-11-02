import { z } from 'zod'
import { ProvinceCode } from './regions.ts'

/** Số tiền VND, số nguyên không âm. */
const Vnd = z.number().int().min(0).max(1_000_000_000)

export const ProvinceShippingFee = z.object({ provinceCode: ProvinceCode, fee: Vnd })
export type ProvinceShippingFee = z.infer<typeof ProvinceShippingFee>

/**
 * Cấu hình phí giao như trang quản trị đọc. `defaultFee` là `null` khi chưa cấu hình: lúc đó cửa hàng chưa nhận đơn.
 * `provinceFees` theo mã tỉnh/thành tăng dần.
 */
export const ShippingFeeConfig = z.object({
  defaultFee: Vnd.nullable(),
  /** Tổng tiền hàng từ mức này trở lên thì phí giao bằng 0; `null` là không có miễn phí giao. */
  freeShippingThreshold: Vnd.nullable(),
  provinceFees: z.array(ProvinceShippingFee),
})
export type ShippingFeeConfig = z.infer<typeof ShippingFeeConfig>

/** Body của `PUT /api/admin/shipping-fees`: thay cả cấu hình; mức mặc định bắt buộc, mỗi tỉnh/thành tối đa một mức riêng. */
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
 * Phí giao của một đơn: mức riêng của tỉnh/thành thắng mức mặc định; tổng tiền hàng từ ngưỡng miễn phí trở lên thì 0.
 * Chỉ gọi khi đã có mức mặc định.
 */
export function shippingFeeFor(
  config: { defaultFee: number; freeShippingThreshold: number | null; provinceFees: readonly ProvinceShippingFee[] },
  provinceCode: string,
  subtotal: number,
) {
  if (config.freeShippingThreshold !== null && subtotal >= config.freeShippingThreshold) return 0
  return config.provinceFees.find((f) => f.provinceCode === provinceCode)?.fee ?? config.defaultFee
}
