import { isDeepStrictEqual } from 'node:util'
import type { ShippingFeeConfig, ShippingFeeConfigRequest } from '@ecommerce/shared'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { readShippingFeeConfig } from './shipping-fee.query.ts'
import type { ShippingFeeRepository } from './shipping-fee.repository.ts'

/** The shop's shipping fees (spec "Phí giao"): one config, replaced whole, audited. */
export class ShippingFeeService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: ShippingFeeRepository,
  ) {}

  get(): Promise<ShippingFeeConfig> {
    return readShippingFeeConfig(this.prisma)
  }

  /** Replaces the config under a lock, so the audit's `before` is exactly what was replaced. No change, no write. */
  update(input: ShippingFeeConfigRequest, ctx: RequestContext): Promise<ShippingFeeConfig> {
    const after: ShippingFeeConfig = {
      ...input,
      provinceFees: [...input.provinceFees].sort((a, b) => a.provinceCode.localeCompare(b.provinceCode)),
    }
    return audited(this.prisma, ctx, async (tx, audit) => {
      await this.repo.lock(tx)
      const before = await readShippingFeeConfig(tx)
      if (isDeepStrictEqual(before, after)) return before
      await this.repo.replace(tx, { ...input, provinceFees: after.provinceFees })
      await audit({
        action: 'shipping.fee.update',
        entityType: 'shipping_fee',
        entityId: 'shipping_fee',
        before,
        after,
      })
      return after
    })
  }
}
