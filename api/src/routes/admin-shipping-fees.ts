import { isDeepStrictEqual } from 'node:util'
import { Router } from 'express'
import { ShippingFeeConfigRequest, type ShippingFeeConfig } from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { parse } from '../http/validation.ts'
import { readShippingFeeConfig } from '../shipping/shipping-fees.ts'

/** Shipping fees use the existing `price.edit`: a fee is a price the customer pays (spec "Phí giao"). */
export function adminShippingFeeRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('price.edit'))
    .get('/', async (_req, res) => {
      const body: ShippingFeeConfig = await readShippingFeeConfig(prisma)
      res.json(body)
    })
    .put('/', async (req, res) => {
      const input = parse(ShippingFeeConfigRequest, req.body)
      const after: ShippingFeeConfig = {
        ...input,
        provinceFees: [...input.provinceFees].sort((a, b) => a.provinceCode.localeCompare(b.provinceCode)),
      }
      const body: ShippingFeeConfig = await audited(prisma, req, async (tx, audit) => {
        // Two concurrent edits do not mix their per-province fees, and the audit's `before` is exactly what was
        // replaced.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('shipping_fee'))`
        const before = await readShippingFeeConfig(tx)
        if (isDeepStrictEqual(before, after)) return before
        await tx.shippingFeeSetting.upsert({
          where: { id: true },
          create: { defaultFee: input.defaultFee, freeShippingThreshold: input.freeShippingThreshold },
          update: { defaultFee: input.defaultFee, freeShippingThreshold: input.freeShippingThreshold },
        })
        await tx.shippingFeeProvince.deleteMany()
        await tx.shippingFeeProvince.createMany({ data: after.provinceFees })
        await audit({
          action: 'shipping.fee.update',
          entityType: 'shipping_fee',
          entityId: 'shipping_fee',
          before,
          after,
        })
        return after
      })
      res.json(body)
    })
}
