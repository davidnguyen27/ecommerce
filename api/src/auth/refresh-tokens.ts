import { randomUUID } from 'node:crypto'
import type { Db, DbClient } from '../db.ts'
import type { AuthAudience } from '../generated/prisma/client.ts'
import { hashOpaqueToken, newOpaqueToken } from './opaque-token.ts'

export type IssuedRefreshToken = { subjectId: string; refreshToken: string; expiresAt: Date }

/** Opens a new family for one sign-in. */
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
 * Swaps the old token for a new one in the same family with the same expiry. Reusing a used token revokes the whole
 * family. Returns `null` when the token is unusable.
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
    // Conditional mark-as-used, so two concurrent requests cannot rotate the same token.
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

/** Revokes every session of a user, e.g. on lock or role change. */
export async function revokeAllRefreshTokens(db: DbClient, audience: AuthAudience, subjectId: string) {
  await db.refreshToken.updateMany({
    where: { audience, subjectId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

/** Revokes one token; unknown or already revoked tokens are ignored. */
export async function revokeRefreshToken(prisma: Db, audience: AuthAudience, refreshToken: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashOpaqueToken(refreshToken), audience, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}
