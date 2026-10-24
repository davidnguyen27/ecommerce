import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import type { DbClient } from '../db.ts'
import type { CustomerTokenPurpose, Prisma } from '../generated/prisma/client.ts'

/** Tạo token một lần cho khách trong `db` và trả link `path?token=…` trên website để gửi qua email. */
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

/** Dùng token một lần trong transaction; trả id khách, hoặc `null` khi token sai, sai mục đích, đã dùng hay hết hạn. */
export async function claimCustomerToken(
  tx: Prisma.TransactionClient,
  token: string,
  purpose: CustomerTokenPurpose,
): Promise<string | null> {
  const now = new Date()
  const found = await tx.customerToken.findUnique({ where: { tokenHash: hashOpaqueToken(token) } })
  if (!found || found.purpose !== purpose) return null
  // Đánh dấu đã dùng có điều kiện, để hai request cùng lúc chỉ một request thành công.
  const claimed = await tx.customerToken.updateMany({
    where: { id: found.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })
  return claimed.count === 0 ? null : found.customerId
}
