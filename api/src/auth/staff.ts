import type { Db } from '../db.ts'
import { hashPassword } from './password.ts'

export type NewStaff = { email: string; password: string; name: string }

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Tạo owner đầu tiên. Email đã có thì giữ nguyên tài khoản cũ, kể cả mật khẩu. */
export async function seedOwner(prisma: Db, owner: NewStaff): Promise<{ created: boolean }> {
  const email = normalizeEmail(owner.email)
  if (await prisma.staff.findUnique({ where: { email } })) return { created: false }

  await prisma.staff.create({
    data: { email, name: owner.name, passwordHash: await hashPassword(owner.password) },
  })
  return { created: true }
}
