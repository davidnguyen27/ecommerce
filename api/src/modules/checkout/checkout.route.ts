import { Router, type RequestHandler } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import type { CheckoutController } from './checkout.controller.ts'

/** Customer checkout under `/api/checkout`, no sign-in needed; a customer access token links the order to the account. */
export class CheckoutRoute implements IRoute {
  readonly path = '/checkout'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: CheckoutController, customerSession: RequestHandler) {
    this.router.post('/quote', c.quote).post('/', customerSession, c.checkout)
  }
}

/** Pre-order quote and placement under `/api/preorders` (ADR 0012, 0013); sign-in as for checkout. */
export class PreorderRoute implements IRoute {
  readonly path = '/preorders'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: CheckoutController, customerSession: RequestHandler) {
    this.router.post('/quote', c.preorderQuote).post('/', customerSession, c.preorder)
  }
}
