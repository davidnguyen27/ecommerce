import { Router } from 'express'
import { ErrorCode, type CustomerProfile } from '@ecommerce/shared'
import { authSubject } from '../auth/require-auth.ts'
import { sendVerificationEmail } from '../customers/email-verification.ts'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'
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

      await prisma.$transaction((tx) => sendVerificationEmail(tx, deps.emails, deps.siteUrl, customer))
      res.status(202).end()
    })
}
