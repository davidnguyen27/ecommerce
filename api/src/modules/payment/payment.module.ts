import type { AppDeps } from '../../app.ts'
import { SimulatorPaymentGateway } from '../../core/adapters/payment/gateway.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { IOrderService } from '../order/index.ts'
import { PaymentController } from './payment.controller.ts'
import { PaymentRoute } from './payment.route.ts'
import { PaymentService } from './payment.service.ts'

/** Wires service → controller → routes. Other code uses the payment functions exported from `index.ts`. */
export class PaymentModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(
    deps: Pick<AppDeps, 'prisma' | 'emails' | 'siteUrl' | 'payments' | 'vnpayHashSecret'>,
    orders: Pick<IOrderService, 'expire'>,
  ) {
    super()
    const service = new PaymentService(deps.prisma, { emails: deps.emails, siteUrl: deps.siteUrl }, orders)
    const controller = new PaymentController(service, deps.vnpayHashSecret)
    this.routes = [
      new PaymentRoute(controller, {
        vnpay: Boolean(deps.vnpayHashSecret),
        simulator: deps.payments instanceof SimulatorPaymentGateway,
      }),
    ]
  }
}
