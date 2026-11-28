import { Router } from 'express'
import { AuditQuery, type AuditActors, type AuditPage } from '@ecommerce/shared'
import { ACTOR_SELECT } from '../core/audit/audited.ts'
import { requirePermission } from '../core/middleware/staff-context.ts'
import type { Db } from '../core/db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { pageWindow } from '../core/pagination.ts'
import { parse } from '../core/middleware/validation.ts'

/** Read-only: the audit log cannot be edited or deleted through the API. */
export function adminAuditRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('audit.view'))
    .get('/', async (req, res) => {
      const query = parse(AuditQuery, req.query)
      const where: Prisma.AuditLogWhereInput = {
        actorId: query.actorId,
        entityType: query.entityType,
        createdAt: {
          ...(query.from && { gte: new Date(query.from) }),
          ...(query.to && { lt: new Date(query.to) }),
        },
      }

      const [entries, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          include: { actor: { select: ACTOR_SELECT } },
          orderBy: { seq: 'desc' },
          ...pageWindow(query),
        }),
        prisma.auditLog.count({ where }),
      ])

      const body: AuditPage = {
        items: entries.map((entry) => ({
          id: entry.id,
          actor: entry.actor,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: entry.before,
          after: entry.after,
          ip: entry.ip,
          userAgent: entry.userAgent,
          createdAt: entry.createdAt.toISOString(),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
      res.json(body)
    })
    .get('/actors', async (_req, res) => {
      const actors = await prisma.staff.findMany({
        where: { auditLogs: { some: {} } },
        select: ACTOR_SELECT,
        orderBy: { name: 'asc' },
      })
      const body: AuditActors = { items: actors }
      res.json(body)
    })
}
