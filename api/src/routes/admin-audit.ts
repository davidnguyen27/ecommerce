import { Router } from 'express'
import { AuditQuery, type AuditActors, type AuditPage } from '@ecommerce/shared'
import { requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { parse } from '../http/validation.ts'

/** Chỉ có endpoint đọc: audit log không sửa hay xóa được qua API. */
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
          include: { actor: { select: { id: true, name: true, email: true } } },
          orderBy: { seq: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
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
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' },
      })
      const body: AuditActors = { items: actors }
      res.json(body)
    })
}
