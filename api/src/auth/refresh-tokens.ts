import { randomUUID } from 'node:crypto'
import type { Db, DbClient } from '../db.ts'
import type { AuthAudience } from '../generated/prisma/client.ts'
import { hashOpaqueToken, newOpaqueToken } from './opaque-token.ts'

export type IssuedRefreshToken = { subjectId: string; refreshToken: string; expiresAt: Date }

/** Mở một family mới cho một lần đăng nhập. */
export async function issueRefreshToken(
  prisma: Db,
  audience: AuthAudience,
  subjectId: string,
  ttlMs: number,
): Promise<IssuedRefreshToken> {
  const refreshToken = newOpaqueToken()
  const expiresAt = new Date(Date.now() + ttlMs)
  await prisma.refreshToken.create({
    data: { audience, subjectId, familyId: randomUUID(), tokenHash: hashOpaqueToken(refreshToken), expiresAt },
  })
  return { subjectId, refreshToken, expiresAt }
}

/**
 * Đổi token cũ lấy token mới cùng family và cùng hạn. Token đã dùng mà bị dùng lại
 * thì thu hồi cả family. Trả `null` khi token không dùng được.
 */
export async function rotateRefreshToken(
  prisma: Db,
  audience: AuthAudience,
  refreshToken: string,
): Promise<IssuedRefreshToken | null> {
  const now = new Date()
  const current = await prisma.refreshToken.findUnique({ where: { tokenHash: hashOpaqueToken(refreshToken) } })
  if (!current || current.audience !== audience || current.revokedAt || current.expiresAt <= now) return null

  const next = newOpaqueToken()
  const rotated = await prisma.$transaction(async (tx) => {
    // Đánh dấu đã dùng có điều kiện, để hai request cùng lúc không rotate được cùng một token.
    const claimed = await tx.refreshToken.updateMany({
      where: { id: current.id, usedAt: null, revokedAt: null },
      data: { usedAt: now },
    })
    if (claimed.count === 0) return false
    await tx.refreshToken.create({
      data: {
        audience,
        subjectId: current.subjectId,
        familyId: current.familyId,
        tokenHash: hashOpaqueToken(next),
        expiresAt: current.expiresAt,
      },
    })
    return true
  })

  if (!rotated) {
    await prisma.refreshToken.updateMany({
      where: { familyId: current.familyId, revokedAt: null },
      data: { revokedAt: now },
    })
    return null
  }
  return { subjectId: current.subjectId, refreshToken: next, expiresAt: current.expiresAt }
}

/** Thu hồi mọi phiên của một người, ví dụ khi khóa tài khoản hoặc đổi role. */
export async function revokeAllRefreshTokens(db: DbClient, audience: AuthAudience, subjectId: string) {
  await db.refreshToken.updateMany({
    where: { audience, subjectId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/** Thu hồi một token; token lạ hoặc đã thu hồi thì bỏ qua. */
export async function revokeRefreshToken(prisma: Db, audience: AuthAudience, refreshToken: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashOpaqueToken(refreshToken), audience, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
