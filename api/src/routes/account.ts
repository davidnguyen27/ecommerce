import { Router } from 'express'
import { ChangePasswordRequest, ErrorCode, type CustomerProfile } from '@ecommerce/shared'
import { hashPassword, verifyPassword } from '../auth/password.ts'
import { authSubject } from '../auth/require-auth.ts'
import { clientOf } from '../auth/session-routes.ts'
import { sendVerificationEmail } from '../customers/email-verification.ts'
import { setCustomerPassword } from '../customers/password-reset.ts'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { parse } from '../http/validation.ts'
import type { CustomerAuthDeps } from './customer-auth.ts'

const signedOut = () => new AppError(401, ErrorCode.UNAUTHORIZED, 'Cần đăng nhập')

function findCustomer(prisma: Db, id: string) {
  return prisma.customer.findUnique({
    where: { id },
    include: {
      consents: {
        orderBy: { consentedAt: 'desc' },
        take: 1,
        include: { policyVersion: { select: { version: true } } },
      },
    },
  })
}

/** Tài khoản của khách đang đăng nhập; đã đi qua `requireAuth` audience customer. */
export function accountRoutes(deps: CustomerAuthDeps) {
  const { prisma } = deps
  return Router()
    .get('/me', async (req, res) => {
      const customer = await findCustomer(prisma, authSubject(req))
      const consent = customer?.consents[0]
      if (!customer || !consent) throw signedOut()

      const body: CustomerProfile = {
        id: customer.id,
        email: customer.email,
        emailVerified: customer.emailVerifiedAt !== null,
        privacyConsent: {
          policyVersion: consent.policyVersion.version,
          consentedAt: consent.consentedAt.toISOString(),
        },
      }
      res.json(body)
    })
    .post('/email-verification', async (req, res) => {
      const customer = await prisma.customer.findUnique({ where: { id: authSubject(req) } })
      if (!customer) throw signedOut()
      // Đã xác minh thì không gửi gì nữa.
      if (customer.emailVerifiedAt) return void res.status(204).end()
      await enforceRateLimits(prisma, res, [{ limit: RATE_LIMITS.verificationEmailPerCustomer, subject: customer.id }])

      await prisma.$transaction((tx) => sendVerificationEmail(tx, deps.emails, deps.siteUrl, customer))
      res.status(202).end()
    })
    .post('/password', async (req, res) => {
      // Kiểm kênh trước khi đổi gì, để bước mở phiên mới ở cuối không thể hỏng.
      clientOf(req)
      const { currentPassword, newPassword } = parse(ChangePasswordRequest, req.body)
      const customer = await prisma.customer.findUnique({ where: { id: authSubject(req) } })
      if (!customer) throw signedOut()
      if (!(await verifyPassword(customer.passwordHash, currentPassword))) {
        throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Mật khẩu hiện tại không đúng', [
          { path: 'currentPassword', message: 'Mật khẩu hiện tại không đúng' },
        ])
      }

      const passwordHash = await hashPassword(newPassword)
      await prisma.$transaction((tx) => setCustomerPassword(tx, customer.id, passwordHash))
      // Mọi phiên đã bị thu hồi; thiết bị đang đổi mật khẩu nhận phiên mới để không phải đăng nhập lại.
      await deps.sessions.start(req, res, customer.id)
    })
}
