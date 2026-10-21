import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Db } from '../db.ts'
import type { AuthAudience } from '../generated/prisma/client.ts'

export type IssuedRefreshToken = { subjectId: string; refreshToken: string; expiresAt: Date }

function newToken(): string {
  return randomBytes(32).toString('base64url')
}

// Token ngẫu nhiên 256 bit nên SHA-256 là đủ, không cần hàm băm chậm như mật khẩu.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Mở một family mới cho một lần đăng nhập. */
export async function issueRefreshToken(
  prisma: Db,
  audience: AuthAudience,
  subjectId: string,
  ttlMs: number,
): Promise<IssuedRefreshToken> {
  const refreshToken = newToken()
  const expiresAt = new Date(Date.now() + ttlMs)
  await prisma.refreshToken.create({
    data: { audience, subjectId, familyId: randomUUID(), tokenHash: hashToken(refreshToken), expiresAt },
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
  const current = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } })
  if (!current || current.audience !== audience || current.revokedAt || current.expiresAt <= now) return null

  const next = newToken()
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
        tokenHash: hashToken(next),
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

/** Thu hồi một token; token lạ hoặc đã thu hồi thì bỏ qua. */
export async function revokeRefreshToken(prisma: Db, audience: AuthAudience, refreshToken: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), audience, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
