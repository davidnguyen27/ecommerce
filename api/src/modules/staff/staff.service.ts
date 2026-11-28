import { ErrorCode, type CreateStaffRequest, type StaffRole, type StaffSummary } from '@ecommerce/shared'
import { audited } from '../../core/audit/audited.ts'
import { normalizeEmail } from '../../core/auth/email.ts'
import { hashPassword } from '../../core/auth/password.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { AppError, isUniqueViolation } from '../../core/errors.ts'
import type { Prisma, Staff } from '../../generated/prisma/client.ts'
import { revokeAllRefreshTokens } from '../auth/index.ts'
import { toStaffSummary } from './staff.mapper.ts'
import type { StaffRepository } from './staff.repository.ts'

function emailTakenError() {
  return new AppError(409, ErrorCode.CONFLICT, 'Email này đã có tài khoản nhân viên', [
    { path: 'email', message: 'Email đã được dùng' },
  ])
}

function sameRoles(a: readonly StaffRole[], b: readonly StaffRole[]) {
  return a.length === b.length && a.every((role) => b.includes(role))
}

/** Changes that invalidate existing sessions: sign-in email, permissions, lock status. */
function affectsSessions(before: Staff, after: Staff) {
  return (
    before.email !== after.email ||
    (before.lockedAt === null) !== (after.lockedAt === null) ||
    !sameRoles(before.roles, after.roles)
  )
}

/**
 * Staff management. Holders of `staff.manage` can assign the owner role, so only owners have it; giving it to another
 * role would need a guard against self-promotion.
 */
export class StaffService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: StaffRepository,
  ) {}

  async list(): Promise<StaffSummary[]> {
    return (await this.repo.findAll(this.prisma)).map(toStaffSummary)
  }

  async create(input: CreateStaffRequest, ctx: RequestContext): Promise<StaffSummary> {
    const email = normalizeEmail(input.email)
    const passwordHash = await hashPassword(input.password)
    const emailTaken = emailTakenError()
    const staff = await audited(this.prisma, ctx, async (tx, audit) => {
      if (await this.repo.findByEmail(tx, email)) throw emailTaken
      const created = await this.repo.create(tx, { email, name: input.name, passwordHash, roles: input.roles })
      await audit({ action: 'staff.create', entityType: 'staff', entityId: created.id, after: toStaffSummary(created) })
      return created
    }).catch((err: unknown) => {
      // Two requests creating the same email past the check above are stopped by the unique index.
      throw isUniqueViolation(err) ? emailTaken : err
    })
    return toStaffSummary(staff)
  }

  update(id: string, input: { name: string; email: string }, ctx: RequestContext) {
    const email = normalizeEmail(input.email)
    return this.change(id, ctx, 'staff.update', (before) => {
      const data: Prisma.StaffUpdateInput = {}
      if (input.name !== before.name) data.name = input.name
      if (email !== before.email) data.email = email
      return Object.keys(data).length ? data : null
    }).catch((err: unknown) => {
      // An email taken by other staff is stopped by the unique index; the rollback drops the audit too.
      throw isUniqueViolation(err) ? emailTakenError() : err
    })
  }

  changeRoles(id: string, roles: StaffRole[], ctx: RequestContext) {
    return this.change(id, ctx, 'staff.roles.change', (before) => (sameRoles(before.roles, roles) ? null : { roles }))
  }

  lock(id: string, ctx: RequestContext) {
    return this.change(id, ctx, 'staff.lock', (before) => (before.lockedAt ? null : { lockedAt: new Date() }))
  }

  unlock(id: string, ctx: RequestContext) {
    return this.change(id, ctx, 'staff.unlock', (before) => (before.lockedAt ? { lockedAt: null } : null))
  }

  /**
   * Updates a staff member with before/after audit. Changing role, lock or email revokes all their sessions so it
   * applies on signed-in devices too; a name change keeps sessions. `change` returns `null` when nothing changes: then
   * nothing is written and no session is revoked. At least one active owner must remain.
   */
  private async change(
    id: string,
    ctx: RequestContext,
    action: string,
    change: (before: Staff) => Prisma.StaffUpdateInput | null,
  ): Promise<StaffSummary> {
    const updated = await audited(this.prisma, ctx, async (tx, audit) => {
      await this.repo.lockOwners(tx)
      const before = await this.repo.findById(tx, id)
      if (!before) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy nhân viên')
      const data = change(before)
      if (!data) return before

      const after = await this.repo.update(tx, id, data)
      if (affectsSessions(before, after)) await revokeAllRefreshTokens(tx, 'staff', id)
      await audit({
        action,
        entityType: 'staff',
        entityId: id,
        before: toStaffSummary(before),
        after: toStaffSummary(after),
      })

      if ((await this.repo.countActiveOwners(tx)) === 0) {
        throw new AppError(409, ErrorCode.CONFLICT, 'Phải còn ít nhất một owner đang hoạt động')
      }
      return after
    })
    return toStaffSummary(updated)
  }
}
