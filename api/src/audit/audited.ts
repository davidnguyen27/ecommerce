import type { Request } from 'express'
import { currentStaff } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'

/** The acting staff member, matching the `AuditActor` fields sent to clients. */
export const ACTOR_SELECT = { id: true, name: true, email: true } as const

export type AuditEntry = {
  action: string
  entityType: string
  entityId: string
  before?: Prisma.InputJsonValue
  after?: Prisma.InputJsonValue
}

/** Writes one audit entry, or several in one statement (in array order). */
export type Audit = (entry: AuditEntry | readonly AuditEntry[]) => Promise<void>

/**
 * An `audited()` transaction already bound to the request, for modules that must also act after commit (e.g. cancel
 * payment links) without taking `req`. Route: `const run: AuditedRun = (fn) => audited(prisma, req, fn)`.
 */
export type AuditedRun = <T>(fn: (tx: Prisma.TransactionClient, audit: Audit) => Promise<T>) => Promise<T>

/**
 * Runs a business change in a transaction and writes the audit in that same transaction, so a rollback drops the
 * audit too. Actor, IP and user agent come from the request. `timeout` (ms) is only for bulk work like import;
 * Prisma's default is 5 s.
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
