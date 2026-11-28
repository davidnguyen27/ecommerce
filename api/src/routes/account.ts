import { Router } from 'express'
import {
  ChangePasswordRequest,
  ErrorCode,
  ShippingAddress,
  type CustomerProfile,
  type LastShippingAddress,
} from '@ecommerce/shared'
import { hashPassword, verifyPassword } from '../auth/password.ts'
import { authSubject } from '../core/middleware/require-auth.ts'
import { clientOf } from '../auth/session-routes.ts'
import { sendVerificationEmail } from '../customers/email-verification.ts'
import { setCustomerPassword } from '../customers/password-reset.ts'
import type { Db } from '../core/db.ts'
import { AppError } from '../core/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../core/middleware/rate-limit.ts'
import { parse } from '../core/middleware/validation.ts'
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

/** The signed-in customer's account; behind `requireAuth` for the customer audience. */
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
    .get('/shipping-address', async (req, res) => {
      const customer = await prisma.customer.findUnique({ where: { id: authSubject(req) } })
      if (!customer) throw signedOut()
      const stored = ShippingAddress.safeParse(customer.lastShippingAddress)
      const body: LastShippingAddress = { address: stored.success ? stored.data : null }
      res.set('Cache-Control', 'no-store').json(body)
    })
    .post('/email-verification', async (req, res) => {
      const customer = await prisma.customer.findUnique({ where: { id: authSubject(req) } })
      if (!customer) throw signedOut()
      // Already verified: send nothing.
      if (customer.emailVerifiedAt) return void res.status(204).end()
      await enforceRateLimits(prisma, [{ limit: RATE_LIMITS.verificationEmailPerCustomer, subject: customer.id }])

      await prisma.$transaction((tx) => sendVerificationEmail(tx, deps.emails, deps.siteUrl, customer))
      res.status(202).end()
    })
    .post('/password', async (req, res) => {
      // Check the channel before changing anything, so opening the new session at the end cannot fail.
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
      // Every session was revoked; the device changing the password gets a new one so it stays signed in.
      await deps.sessions.start(req, res, customer.id)
    })
}
