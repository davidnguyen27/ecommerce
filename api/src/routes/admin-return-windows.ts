import { Router } from 'express'
import { ReturnWindowList } from '@ecommerce/shared'
import { audited } from '../core/audit/audited.ts'
import { requirePermission } from '../core/middleware/staff-context.ts'
import type { Db } from '../core/db.ts'
import { parse } from '../core/middleware/validation.ts'
import { loadReturnWindows, saveReturnWindows } from '../support/returns.ts'

/**
 * Return windows per product type (GLOSSARY "Hạn đổi trả", spec M6b), mounted at `/return-windows`. Viewable by
 * content editors, request handlers and order viewers; editing needs `content.edit` (it goes with the returns policy
 * page), audited.
 */
export function adminReturnWindowRoutes(prisma: Db) {
  return Router()
    .get('/', requirePermission('content.edit', 'support.handle', 'order.view'), async (_req, res) => {
      const body: ReturnWindowList = { items: await loadReturnWindows(prisma) }
      res.json(body)
    })
    .put('/', requirePermission('content.edit'), async (req, res) => {
      const { items } = parse(ReturnWindowList, req.body)
      await audited(prisma, req, (tx, audit) => saveReturnWindows(tx, audit, items))
      const body: ReturnWindowList = { items: await loadReturnWindows(prisma) }
      res.json(body)
    })
}
