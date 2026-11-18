import { Router } from 'express'
import { ReturnWindowList } from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { parse } from '../http/validation.ts'
import { loadReturnWindows, saveReturnWindows } from '../support/returns.ts'

/**
 * Hạn đổi trả theo nhóm hàng (GLOSSARY, spec M6b), mount tại `/return-windows`. Xem: người sửa nội dung, người xử lý
 * yêu cầu và người xem đơn; sửa: `content.edit` (đi cùng trang chính sách đổi trả), có audit.
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
