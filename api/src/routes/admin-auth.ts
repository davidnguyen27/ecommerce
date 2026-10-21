import { sessionRoutes } from '../auth/session-routes.ts'
import { normalizeEmail } from '../auth/staff.ts'
import type { Db } from '../db.ts'

const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000

/** Đăng nhập, refresh, đăng xuất của nhân viên, gắn tại `mountPath`. Không đòi access token. */
export function adminAuthRoutes(prisma: Db, secret: Uint8Array, mountPath: string) {
  return sessionRoutes({
    prisma,
    secret,
    audience: 'staff',
    sessionTtlMs: STAFF_SESSION_TTL_MS,
    refreshPath: `${mountPath}/refresh`,
    findCredentials: (email) =>
      prisma.staff.findUnique({
        where: { email: normalizeEmail(email), lockedAt: null },
        select: { id: true, passwordHash: true },
      }),
    isActive: async (id) => (await prisma.staff.count({ where: { id, lockedAt: null } })) > 0,
  })
}
