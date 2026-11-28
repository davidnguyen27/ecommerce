import type { Db } from '../../core/db.ts'
import { normalizeEmail } from '../../core/auth/email.ts'
import { hashPassword } from '../../core/auth/password.ts'

export type NewStaff = { email: string; password: string; name: string }

/** Creates the first owner. An existing email keeps its account, password included. */
export async function seedOwner(prisma: Db, owner: NewStaff): Promise<{ created: boolean }> {
  const email = normalizeEmail(owner.email)
  if (await prisma.staff.findUnique({ where: { email } })) return { created: false }

  await prisma.staff.create({
    data: { email, name: owner.name, passwordHash: await hashPassword(owner.password), roles: ['owner'] },
  })
  return { created: true }
}
