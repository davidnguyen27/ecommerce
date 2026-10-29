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

/** Ghi một bản audit, hoặc nhiều bản trong một câu lệnh (theo đúng thứ tự trong mảng). */
export type Audit = (entry: AuditEntry | readonly AuditEntry[]) => Promise<void>

/**
 * Chạy thay đổi nghiệp vụ trong một transaction và ghi audit vào chính transaction đó:
 * thay đổi rollback thì bản ghi audit cũng không còn. Người thực hiện, IP và user agent lấy từ request.
 * `timeout` (ms) chỉ cần cho thao tác hàng loạt như import; mặc định của Prisma là 5 giây.
 */
export function audited<T>(
  prisma: Db,
  req: Request,
  fn: (tx: Prisma.TransactionClient, audit: Audit) => Promise<T>,
  options: { timeout?: number } = {},
): Promise<T> {
  const actorId = currentStaff(req).id
  const ip = req.ip ?? null
  const userAgent = req.get('user-agent') ?? null

  return prisma.$transaction(
    (tx) =>
      fn(tx, async (entry) => {
        const entries: readonly AuditEntry[] = 'action' in entry ? [entry] : entry
        if (entries.length === 1) await tx.auditLog.create({ data: { ...entries[0]!, actorId, ip, userAgent } })
        else if (entries.length > 1) {
          await tx.auditLog.createMany({ data: entries.map((e) => ({ ...e, actorId, ip, userAgent })) })
        }
      }),
    options.timeout === undefined ? undefined : { timeout: options.timeout, maxWait: 10_000 },
  )
}
