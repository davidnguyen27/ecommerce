import { Router } from 'express'
import { EMPTY_LEGAL_INFO, LegalInfo } from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import type { Db, DbClient } from '../db.ts'
import { parse } from '../http/validation.ts'

const KEY = 'legal_info'

/** Đọc từ cấu hình hệ thống; trường nào chưa lưu (kể cả trường mới thêm sau này) thì rỗng. */
async function readLegalInfo(db: DbClient): Promise<LegalInfo> {
  const row = await db.systemConfig.findUnique({ where: { key: KEY } })
  return LegalInfo.parse({ ...EMPTY_LEGAL_INFO, ...(row?.value as object | undefined) })
}

/** Khách đọc thông tin pháp lý để hiện ở chân trang. */
export function publicLegalInfoRoutes(prisma: DbClient) {
  return Router().get('/', async (_req, res) => {
    res.json(await readLegalInfo(prisma))
  })
}

/** Sửa thông tin pháp lý cần `content.edit`, vì nó là nội dung công bố trên website như các trang chính sách. */
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
        // Cả hai đều qua cùng schema nên cùng thứ tự khóa.
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
