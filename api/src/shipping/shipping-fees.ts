import { ErrorCode, type ShippingFeeConfig } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import { AppError } from '../http/errors.ts'

/** Cấu hình phí giao hiện tại; `defaultFee` là `null` khi chưa cấu hình. */
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
 * Cấu hình phí giao để tính tiền cho khách. Chưa có mức mặc định thì 503: thà không nhận đơn còn hơn nhận một đơn
 * sai tiền giao. Dùng chung cho báo giá và đặt mua.
 */
export async function requireShippingFeeConfig(db: DbClient) {
  const config = await readShippingFeeConfig(db)
  if (config.defaultFee === null) {
    throw new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, 'Cửa hàng chưa sẵn sàng nhận đơn')
  }
  return { ...config, defaultFee: config.defaultFee }
}
