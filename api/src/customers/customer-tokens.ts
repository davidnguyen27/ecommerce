import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import type { DbClient } from '../db.ts'
import type { CustomerTokenPurpose, Prisma } from '../generated/prisma/client.ts'

/** Creates a one-time customer token in `db` and returns the website link `path?token=…` for email. */
export async function issueCustomerToken(
  db: DbClient,
  customerId: string,
  purpose: CustomerTokenPurpose,
  ttlMs: number,
  siteUrl: string,
  path: string,
): Promise<URL> {
  const token = newOpaqueToken()
  await db.customerToken.create({
    data: { customerId, purpose, tokenHash: hashOpaqueToken(token), expiresAt: new Date(Date.now() + ttlMs) },
  })
  const link = new URL(path, siteUrl)
  link.searchParams.set('token', token)
  return link
}

/** Uses a one-time token in the transaction; the customer id, or `null` if wrong, wrong purpose, used or expired. */
export async function claimCustomerToken(
  tx: Prisma.TransactionClient,
  token: string,
  purpose: CustomerTokenPurpose,
): Promise<string | null> {
  const now = new Date()
  const found = await tx.customerToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } })
  if (!found || found.purpose !== purpose) return null
  // Conditional mark-as-used, so only one of two concurrent requests succeeds.
  const claimed = await tx.customerToken.updateMany({
    where: { id: found.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })
  return claimed.count === 0 ? null : found.customerId
}
