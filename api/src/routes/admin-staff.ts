import { Router, type Request } from 'express'
import { z } from 'zod'
import {
  ChangeRolesRequest,
  CreateStaffRequest,
  ErrorCode,
  type StaffList,
  type StaffRole,
  type StaffSummary,
} from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { hashPassword } from '../auth/password.ts'
import { revokeAllRefreshTokens } from '../auth/refresh-tokens.ts'
import { requirePermission } from '../auth/staff-context.ts'
import { normalizeEmail } from '../auth/staff.ts'
import type { Db } from '../db.ts'
import { Prisma, type Staff } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

function toSummary(staff: Staff): StaffSummary {
  return {
    id: staff.id,
    email: staff.email,
    name: staff.name,
    roles: staff.roles,
    locked: staff.lockedAt !== null,
    createdAt: staff.createdAt.toISOString(),
  }
}

/**
 * Quản lý nhân viên; mọi route cần `staff.manage`.
 * Người có quyền này gán được cả role owner, nên hiện chỉ owner có nó; cấp cho role khác thì phải chặn việc tự nâng quyền.
 */
export function adminStaffRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('staff.manage'))
    .get('/', async (_req, res) => {
      const staff = await prisma.staff.findMany({ orderBy: { createdAt: 'asc' } })
      const body: StaffList = { items: staff.map(toSummary) }
      res.json(body)
    })
    .post('/', async (req, res) => {
      const input = parse(CreateStaffRequest, req.body)
      const email = normalizeEmail(input.email)
      const passwordHash = await hashPassword(input.password)

      const emailTaken = new AppError(409, ErrorCode.CONFLICT, 'Email này đã có tài khoản nhân viên', [
        { path: 'email', message: 'Email đã được dùng' },
      ])
      const staff = await audited(prisma, req, async (tx, audit) => {
        if (await tx.staff.findUnique({ where: { email } })) throw emailTaken
        const created = await tx.staff.create({ data: { email, name: input.name, passwordHash, roles: input.roles } })
        await audit({ action: 'staff.create', entityType: 'staff', entityId: created.id, after: toSummary(created) })
        return created
      }).catch((err: unknown) => {
        // Hai request cùng tạo một email lọt qua bước kiểm tra trên thì unique index chặn lại.
        throw err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? emailTaken : err
      })
      res.status(201).json(toSummary(staff))
    })
    .put('/:id/roles', async (req, res) => {
      const { roles } = parse(ChangeRolesRequest, req.body)
      res.json(
        await updateStaff(prisma, req, 'staff.roles.change', (before) =>
          sameRoles(before.roles, roles) ? null : { roles },
        ),
      )
    })
    .post('/:id/lock', async (req, res) => {
      res.json(await updateStaff(prisma, req, 'staff.lock', (before) => (before.lockedAt ? null : { lockedAt: new Date() })))
    })
    .post('/:id/unlock', async (req, res) => {
      res.json(await updateStaff(prisma, req, 'staff.unlock', (before) => (before.lockedAt ? { lockedAt: null } : null)))
    })
}

const StaffParams = z.object({ id: z.uuid() })

function sameRoles(a: readonly StaffRole[], b: readonly StaffRole[]) {
  return a.length === b.length && a.every((role) => b.includes(role))
}

/**
 * Sửa một nhân viên kèm audit trước/sau, và thu hồi mọi phiên của người đó
 * để quyền mới hay trạng thái khóa áp dụng cả với các thiết bị đang đăng nhập.
 * `change` trả `null` khi không có gì đổi: khi đó không ghi gì và không thu hồi phiên.
 */
async function updateStaff(
  prisma: Db,
  req: Request,
  action: string,
  change: (before: Staff) => Prisma.StaffUpdateInput | null,
) {
  const { id } = parse(StaffParams, req.params)
  const updated = await audited(prisma, req, async (tx, audit) => {
    // Xếp hàng các thay đổi role/khóa, để hai owner không cùng gỡ nhau rồi không còn ai.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('staff.owners'))`
    const before = await tx.staff.findUnique({ where: { id } })
    if (!before) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy nhân viên')
    const data = change(before)
    if (!data) return before

    const after = await tx.staff.update({ where: { id }, data })
    await revokeAllRefreshTokens(tx, 'staff', id)
    await audit({ action, entityType: 'staff', entityId: id, before: toSummary(before), after: toSummary(after) })

    const activeOwners = await tx.staff.count({ where: { roles: { has: 'owner' }, lockedAt: null } })
    if (activeOwners === 0) {
      throw new AppError(409, ErrorCode.CONFLICT, 'Phải còn ít nhất một owner đang hoạt động')
    }
    return after
  })
  return toSummary(updated)
}
