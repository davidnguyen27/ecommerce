import { Router } from 'express'
import {
  ErrorCode,
  ForgotPasswordRequest,
  RegisterRequest,
  ResetPasswordRequest,
  VerifyEmailRequest,
} from '@ecommerce/shared'
import { createSessions } from '../auth/session-routes.ts'
import { hashPassword } from '../auth/password.ts'
import { normalizeEmail } from '../auth/staff.ts'
import { findCurrentPrivacyPolicy } from '../content/pages.ts'
import { sendVerificationEmail, verifyEmail } from '../customers/email-verification.ts'
import { resetPassword, sendPasswordResetEmail } from '../customers/password-reset.ts'
import type { Db } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { parse } from '../http/validation.ts'
import type { EmailQueue } from '../jobs/jobs.ts'

const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type CustomerAuthDeps = {
  prisma: Db
  emails: EmailQueue
  /** Gốc URL của website, dùng để dựng link trong email. */
  siteUrl: string
  sessions: CustomerSessions
}

export type CustomerSessions = ReturnType<typeof customerSessions>

/** Phiên của miền khách; refresh token nằm ở `${mountPath}/refresh`. Dùng chung cho mọi route cần mở phiên. */
export function customerSessions(prisma: Db, secret: Uint8Array, mountPath: string) {
  return createSessions({
    prisma,
    secret,
    audience: 'customer',
    sessionTtlMs: CUSTOMER_SESSION_TTL_MS,
    refreshPath: `${mountPath}/refresh`,
    findCredentials: (email) =>
      prisma.customer.findUnique({ where: { email: normalizeEmail(email) }, select: { id: true, passwordHash: true } }),
    isActive: async (id) => (await prisma.customer.count({ where: { id } })) > 0,
  })
}

/** Đăng ký, xác minh email, quên mật khẩu, đăng nhập, refresh, đăng xuất của khách. Không đòi access token. */
export function customerAuthRoutes(deps: CustomerAuthDeps) {
  const { prisma, sessions } = deps

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
    .post('/forgot-password', async (req, res) => {
      const email = normalizeEmail(parse(ForgotPasswordRequest, req.body).email)
      await enforceRateLimits(prisma, res, [
        { limit: RATE_LIMITS.forgotPasswordPerEmail, subject: email },
        { limit: RATE_LIMITS.forgotPasswordPerIp, subject: String(req.ip) },
      ])
      const customer = await prisma.customer.findUnique({ where: { email } })
      if (customer) {
        await prisma.$transaction((tx) => sendPasswordResetEmail(tx, deps.emails, deps.siteUrl, customer))
      }
      // Cùng một phản hồi dù email có tài khoản hay không.
      res.status(202).end()
    })
    .post('/reset-password', async (req, res) => {
      const { token, password } = parse(ResetPasswordRequest, req.body)
      if (!(await resetPassword(prisma, token, password))) {
        throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn')
      }
      res.status(204).end()
    })
    .use(sessions.routes)
}
