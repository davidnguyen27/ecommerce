import type { AuditPage } from '@ecommerce/shared'
import type { AuditLogRow } from './audit-log.repository.ts'

export function toAuditEntry(entry: AuditLogRow): AuditPage['items'][number] {
  return {
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
  }
}
