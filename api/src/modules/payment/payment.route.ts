import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import type { PaymentController } from './payment.controller.ts'

/**
 * The payment gateway reports money under `/api/payments`; no sign-in. VNPAY routes exist only with a hash secret;
 * simulator routes only when the API runs the simulator (local, smoke).
 */
export class PaymentRoute implements IRoute {
  readonly path = '/payments'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: PaymentController, options: { vnpay: boolean; simulator: boolean }) {
    if (options.vnpay) this.router.get('/vnpay/ipn', c.vnpayIpn).post('/vnpay/return', c.vnpayReturn)
    if (options.simulator) {
      this.router.post('/simulator/paid', c.simulatePaid).post('/simulator/expired', c.simulateExpiry)
    }
  }
}
