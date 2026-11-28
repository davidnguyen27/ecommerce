import type { ShippingFeeConfigRequest } from '@ecommerce/shared'
import type { Prisma } from '../../generated/prisma/client.ts'

/** Writes to the one shipping fee config (setting row plus per-province fees); reads are in `shipping-fee.query.ts`. */
export class ShippingFeeRepository {
  /** Serializes edits, so two concurrent edits never mix their per-province fees. */
  async lock(tx: Prisma.TransactionClient) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shipping_fee'))`
  }

  async replace(tx: Prisma.TransactionClient, config: ShippingFeeConfigRequest) {
    const { defaultFee, freeShippingThreshold } = config
    await tx.shippingFeeSetting.upsert({
      where: { id: true },
      create: { defaultFee, freeShippingThreshold },
      update: { defaultFee, freeShippingThreshold },
    })
    await tx.shippingFeeProvince.deleteMany()
    await tx.shippingFeeProvince.createMany({ data: config.provinceFees })
  }
}
