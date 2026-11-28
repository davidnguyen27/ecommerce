import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import type { CustomerController } from './customer.controller.ts'

/** The signed-in customer's account under `/api/account`. */
export class CustomerRoute implements IRoute {
  readonly path = '/account'
  readonly access = 'customer'
  readonly router = Router()

  constructor(c: CustomerController) {
    this.router
      .get('/me', c.me)
      .get('/shipping-address', c.shippingAddress)
      .post('/email-verification', c.resendVerification)
      .post('/password', c.changePassword)
  }
}
