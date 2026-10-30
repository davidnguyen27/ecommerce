import { z } from 'zod'
import { PageQuery, pageOf } from './pagination.ts'

/** Query string của `GET /api/admin/audit`. Khoảng thời gian tính `from <= createdAt < to`. */
export const AuditQuery = z.object({
  actorId: z.uuid().optional(),
  entityType: z.string().min(1).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  ...PageQuery.shape,
})
export type AuditQuery = z.infer<typeof AuditQuery>

export const AuditActor = z.object({ id: z.string(), name: z.string(), email: z.string() })
export type AuditActor = z.infer<typeof AuditActor>

/** Những nhân viên đã có ít nhất một bản ghi audit. */
export const AuditActors = z.object({ items: z.array(AuditActor) })
export type AuditActors = z.infer<typeof AuditActors>

export const AuditEntry = z.object({
  id: z.string(),
  actor: AuditActor,
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
})
export type AuditEntry = z.infer<typeof AuditEntry>

export const AuditPage = pageOf(AuditEntry)
export type AuditPage = z.infer<typeof AuditPage>
