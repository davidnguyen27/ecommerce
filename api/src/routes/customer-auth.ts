import { Router } from 'express'
import { ErrorCode, RegisterRequest, VerifyEmailRequest } from '@ecommerce/shared'
import { createSessions } from '../auth/session-routes.ts'
import { hashPassword } from '../auth/password.ts'
import { normalizeEmail } from '../auth/staff.ts'
import { findCurrentPrivacyPolicy } from '../content/pages.ts'
import { sendVerificationEmail, verifyEmail } from '../customers/email-verification.ts'
import type { Db } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import type { EmailQueue } from '../jobs/jobs.ts'

const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type CustomerAuthDeps = {
  prisma: Db
  secret: Uint8Array
  emails: EmailQueue
  /** Gốc URL của website, dùng để dựng link trong email. */
  siteUrl: string
}

/** Đăng ký, xác minh email, đăng nhập, refresh, đăng xuất của khách, gắn tại `mountPath`. Không đòi access token. */
export function customerAuthRoutes(deps: CustomerAuthDeps, mountPath: string) {
  const { prisma } = deps
  const sessions = createSessions({
    prisma,
    secret: deps.secret,
    audience: 'customer',
    sessionTtlMs: CUSTOMER_SESSION_TTL_MS,
    refreshPath: `${mountPath}/refresh`,
    findCredentials: (email) =>
      prisma.customer.findUnique({ where: { email: normalizeEmail(email) }, select: { id: true, passwordHash: true } }),
    isActive: async (id) => (await prisma.customer.count({ where: { id } })) > 0,
  })

  return Router()
    .post('/register', async (req, res) => {
      const input = parse(RegisterRequest, req.body)
      const email = normalizeEmail(input.email)
      const passwordHash = await hashPassword(input.password)

      const customer = await prisma
        .$transaction(async (tx) => {
          // Đọc phiên bản trong cùng transaction, để lời đồng ý trỏ đúng bản hiện hành lúc tạo tài khoản.
          const policy = await findCurrentPrivacyPolicy(tx)
          if (!policy) {
            throw new AppError(
              503,
              ErrorCode.SERVICE_UNAVAILABLE,
              'Chưa thể đăng ký vì chính sách bảo mật chưa được công bố',
            )
          }
          const created = await tx.customer.create({
            data: { email, passwordHash, consents: { create: { policyVersionId: policy.id } } },
          })
          await sendVerificationEmail(tx, deps.emails, deps.siteUrl, created)
          return created
        })
        .catch((err: unknown) => {
          // Chỉ báo trùng, không nói thêm gì về tài khoản đã có.
          throw err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
            ? new AppError(409, ErrorCode.CONFLICT, 'Email này đã được đăng ký')
            : err
        })

      await sessions.start(req, res, customer.id, 201)
    })
    .post('/verify-email', async (req, res) => {
      const { token } = parse(VerifyEmailRequest, req.body)
      if (!(await verifyEmail(prisma, token))) {
        throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Link xác minh không hợp lệ hoặc đã hết hạn')
      }
      res.status(204).end()
    })
    .use(sessions.routes)
}
