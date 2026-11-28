import type { AppDeps } from '../../app.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import { recordGatewayPayments } from '../payment/index.ts'
import { createRefund, refundTotals, refundedViaGateway, summarizeRefunds } from '../refund/index.ts'
import { preorderApi } from '../preorder-campaign/index.ts'
import { resolveCancelRequests } from '../support/index.ts'
import { stockLedger } from '../stock/index.ts'
import { OrderController } from './order.controller.ts'
import type { IOrderQuery, IOrderService, OrderDeps, OrderPorts } from './order.interface.ts'
import { OrderQuery } from './order.query.ts'
import { OrderRepository } from './order.repository.ts'
import { OrderAccountRoute, OrderAdminRoute, OrderPublicRoute } from './order.route.ts'
import { OrderService } from './order.service.ts'

/** Other modules' functions the order commands call in their own transactions; all stateless. */
function modulePorts(): OrderPorts {
  return {
    stock: stockLedger,
    gatewayPayments: { record: recordGatewayPayments },
    refunds: {
      totals: refundTotals,
      create: createRefund,
      summarize: summarizeRefunds,
      viaGateway: refundedViaGateway,
    },
    arrivals: { plan: preorderApi.planArrivals, apply: preorderApi.applyArrivals },
    support: { resolveCancelRequests },
    remainder: { createLink: preorderApi.createRemainderLink },
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
    const ports = modulePorts()
    const service = new OrderService(deps, repo, ports)
    const query = new OrderQuery(deps, repo, ports.refunds)
    const controller = new OrderController(deps, service, query, repo, ports)
    this.routes = [new OrderAdminRoute(controller), new OrderAccountRoute(controller), new OrderPublicRoute(controller)]
    this.service = service
    this.query = query
  }
}

/**
 * Order commands for the job worker (`src/jobs/worker.ts`), which runs without the HTTP modules. Stateless besides
 * `deps`, so building one per call is fine.
 */
export function createOrderService(deps: OrderDeps): IOrderService {
  return new OrderService(deps, new OrderRepository(), modulePorts())
}

/** The sweep job's entry point (also called directly by tests, as job code is): cancels every overdue pending order. */
export function expireOverdueOrders(deps: OrderDeps, now?: Date) {
  return createOrderService(deps).expireOverdue(now)
}
