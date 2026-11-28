import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
// Adapters to code not moved into modules yet; each port moves to its module's interface when that module moves.
import { recordGatewayPayments } from '../../payments/record-payment.ts'
import { createRefund, refundTotals, refundedViaGateway, summarizeRefunds } from '../../payments/refunds.ts'
import { applyArrivals, planArrivals } from '../../preorders/arrivals.ts'
import { createRemainderLink } from '../../preorders/remainder.ts'
import { resolveCancelRequests } from '../../support/support.ts'
import { stockLedger } from '../stock/index.ts'
import { OrderController } from './order.controller.ts'
import type { IOrderQuery, IOrderService, OrderDeps, OrderPorts, OrderQueryDeps } from './order.interface.ts'
import { OrderQuery } from './order.query.ts'
import { OrderRepository } from './order.repository.ts'
import { OrderAccountRoute, OrderAdminRoute, OrderPublicRoute } from './order.route.ts'
import { OrderService } from './order.service.ts'

function legacyPorts(): OrderPorts {
  return {
    stock: stockLedger,
    gatewayPayments: { record: recordGatewayPayments },
    refunds: {
      totals: refundTotals,
      create: createRefund,
      summarize: summarizeRefunds,
      viaGateway: refundedViaGateway,
    },
    arrivals: { plan: planArrivals, apply: applyArrivals },
    support: { resolveCancelRequests },
    remainder: { createLink: createRemainderLink },
  }
}

/** Wires repository → service and query → controller → routes. Other modules use `service` and `query`. */
export class OrderModule extends BaseModule {
  readonly routes: readonly IRoute[]
  readonly service: IOrderService
  readonly query: IOrderQuery

  constructor(deps: AppDeps) {
    super()
    const repo = new OrderRepository()
    const ports = legacyPorts()
    const service = new OrderService(deps, repo, ports)
    const query = new OrderQuery(deps, repo, ports.refunds)
    const controller = new OrderController(deps, service, query, repo, ports)
    this.routes = [new OrderAdminRoute(controller), new OrderAccountRoute(controller), new OrderPublicRoute(controller)]
    this.service = service
    this.query = query
  }
}

/**
 * Order commands for code outside `modules/` that has no module wiring yet (jobs, gateway callbacks, pre-order
 * campaigns). Stateless besides `deps`, so building one per call is fine. Removed once those move.
 */
export function createOrderService(deps: OrderDeps): IOrderService {
  return new OrderService(deps, new OrderRepository(), legacyPorts())
}

/** Order views for code outside `modules/` (reconciliation, refunds, support). Removed once those move. */
export function createOrderQuery(deps: OrderQueryDeps): IOrderQuery {
  return new OrderQuery(deps, new OrderRepository(), legacyPorts().refunds)
}

/** The sweep job's entry point (also called directly by tests, as job code is): cancels every overdue pending order. */
export function expireOverdueOrders(deps: OrderDeps, now?: Date) {
  return createOrderService(deps).expireOverdue(now)
}
