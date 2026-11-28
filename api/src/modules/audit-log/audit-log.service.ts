import type { AuditActors, AuditPage, AuditQuery } from '@ecommerce/shared'
import type { z } from 'zod'
import type { Db } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { toAuditEntry } from './audit-log.mapper.ts'
import type { AuditLogRepository } from './audit-log.repository.ts'

/** The audit log, newest first (ADR 0003). Read-only. */
export class AuditLogService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: AuditLogRepository,
  ) {}

  async list(query: z.output<typeof AuditQuery>): Promise<AuditPage> {
    const where: Prisma.AuditLogWhereInput = {
      actorId: query.actorId,
      entityType: query.entityType,
      createdAt: {
        ...(query.from && { gte: new Date(query.from) }),
        ...(query.to && { lt: new Date(query.to) }),
      },
    }
    const { entries, total } = await this.repo.page(this.prisma, where, query)
    return { items: entries.map(toAuditEntry), total, page: query.page, pageSize: query.pageSize }
  }

  async actors(): Promise<AuditActors> {
    return { items: await this.repo.actors(this.prisma) }
  }
}
