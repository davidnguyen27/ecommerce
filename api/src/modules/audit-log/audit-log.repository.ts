import { ACTOR_SELECT } from '../../core/audit/audited.ts'
import type { DbClient } from '../../core/db.ts'
import { pageWindow } from '../../core/pagination.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

const ENTRY_INCLUDE = { actor: { select: ACTOR_SELECT } } as const satisfies Prisma.AuditLogInclude

export type AuditLogRow = Prisma.AuditLogGetPayload<{ include: typeof ENTRY_INCLUDE }>

/** Reads only: the audit log cannot be edited or deleted through the API. Every method takes `db`. */
export class AuditLogRepository {
  async page(db: DbClient, where: Prisma.AuditLogWhereInput, window: { page: number; pageSize: number }) {
    const [entries, total] = await Promise.all([
      db.auditLog.findMany({ where, include: ENTRY_INCLUDE, orderBy: { seq: 'desc' }, ...pageWindow(window) }),
      db.auditLog.count({ where }),
    ])
    return { entries, total }
  }

  /** Staff who appear in the log, for the filter. */
  actors(db: DbClient) {
    return db.staff.findMany({ where: { auditLogs: { some: {} } }, select: ACTOR_SELECT, orderBy: { name: 'asc' } })
  }
}
