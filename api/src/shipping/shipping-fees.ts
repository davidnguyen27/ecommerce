import { ErrorCode, type ShippingFeeConfig } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import { AppError } from '../http/errors.ts'

/** Current shipping fee config; `defaultFee` is `null` when unset. */
export async function readShippingFeeConfig(db: DbClient): Promise<ShippingFeeConfig> {
  const [setting, provinces] = await Promise.all([
    db.shippingFeeSetting.findUnique({ where: { id: true } }),
    db.shippingFeeProvince.findMany({ orderBy: { provinceCode: 'asc' } }),
  ])
  return {
    defaultFee: setting?.defaultFee ?? null,
    freeShippingThreshold: setting?.freeShippingThreshold ?? null,
    provinceFees: provinces.map(({ provinceCode, fee }) => ({ provinceCode, fee })),
  }
}

/**
 * Shipping config for pricing. No default fee gives 503: better to take no orders than orders with a wrong fee. Shared
 * by quote and checkout.
 */
export async function requireShippingFeeConfig(db: DbClient) {
  const config = await readShippingFeeConfig(db)
  if (config.defaultFee === null) {
    throw new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, 'Cửa hàng chưa sẵn sàng nhận đơn')
  }
  return { ...config, defaultFee: config.defaultFee }
}
