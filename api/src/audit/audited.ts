import type { Request } from 'express'
import { currentStaff } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'

export type AuditEntry = {
  action: string
  entityType: string
  entityId: string
  before?: Prisma.InputJsonValue
  after?: Prisma.InputJsonValue
}

export type Audit = (entry: AuditEntry) => Promise<void>

/**
 * Chạy thay đổi nghiệp vụ trong một transaction và ghi audit vào chính transaction đó:
 * thay đổi rollback thì bản ghi audit cũng không còn. Người thực hiện, IP và user agent lấy từ request.
 */
export function audited<T>(
  prisma: Db,
  req: Request,
  fn: (tx: Prisma.TransactionClient, audit: Audit) => Promise<T>,
): Promise<T> {
  const actorId = currentStaff(req).id
  const ip = req.ip ?? null
  const userAgent = req.get('user-agent') ?? null

  return prisma.$transaction((tx) =>
    fn(tx, async (entry) => {
      await tx.auditLog.create({ data: { ...entry, actorId, ip, userAgent } })
    }),
  )
}
