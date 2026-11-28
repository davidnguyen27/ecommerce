import { Router } from 'express'
import { EMPTY_LEGAL_INFO, LegalInfo } from '@ecommerce/shared'
import { audited } from '../core/audit/audited.ts'
import { requirePermission } from '../core/middleware/staff-context.ts'
import type { Db, DbClient } from '../core/db.ts'
import { parse } from '../core/middleware/validation.ts'

const KEY = 'legal_info'

/** Read from system config; fields never saved (new ones included) are empty. */
async function readLegalInfo(db: DbClient): Promise<LegalInfo> {
  const row = await db.systemConfig.findUnique({ where: { key: KEY } })
  return LegalInfo.parse({ ...EMPTY_LEGAL_INFO, ...(row?.value as object | undefined) })
}

/** Customers read legal info for the footer. */
export function publicLegalInfoRoutes(prisma: DbClient) {
  return Router().get('/', async (_req, res) => {
    res.json(await readLegalInfo(prisma))
  })
}

/** Editing legal info needs `content.edit`, since it is published website content like policy pages. */
export function adminLegalInfoRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('content.edit'))
    .get('/', async (_req, res) => {
      res.json(await readLegalInfo(prisma))
    })
    .put('/', async (req, res) => {
      const input = parse(LegalInfo, req.body)
      const saved = await audited(prisma, req, async (tx, audit) => {
        const before = await readLegalInfo(tx)
        // Both go through the same schema, so the same lock order.
        if (JSON.stringify(before) === JSON.stringify(input)) return before
        await tx.systemConfig.upsert({
          where: { key: KEY },
          create: { key: KEY, value: input },
          update: { value: input },
        })
        await audit({ action: 'legal_info.change', entityType: 'system_config', entityId: KEY, before, after: input })
        return input
      })
      res.json(saved)
    })
}
