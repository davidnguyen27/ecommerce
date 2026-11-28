import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import type { CustomerAuthController } from './customer-auth.controller.ts'

/**
 * Customer sign-up, email verification, forgot password, sign-in, refresh, sign-out under `/api/auth`. No access token
 * required.
 */
export class CustomerAuthRoute implements IRoute {
  readonly path = '/auth'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: CustomerAuthController, sessionRoutes: Router) {
    this.router
      .post('/register', c.register)
      .post('/verify-email', c.verifyEmail)
      .post('/forgot-password', c.forgotPassword)
      .post('/reset-password', c.resetPassword)
      .use(sessionRoutes)
  }
}
