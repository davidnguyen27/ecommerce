import type { Request, Response } from 'express'
import type { AccountOrderPage, AdminOrder, AdminOrderPage, PayRemainderResult, PublicOrder } from '@ecommerce/shared'
import type { Storage } from '../../core/adapters/storage.ts'
import { contextOf, type RequestContext } from '../../core/context/request-context.ts'
import { RATE_LIMITS, withinRateLimit } from '../../core/middleware/rate-limit.ts'
import { authSubject } from '../../core/middleware/require-auth.ts'
import { dtoOf, parse } from '../../core/middleware/validation.ts'
import { orderNotFound } from './order.constant.ts'
import {
  AccountOrderQueryDto,
  AdminOrderQueryDto,
  CancelPaidOrderDto,
  HandoverDto,
  RedeliverDto,
  ReturnToStockDto,
} from './dto/index.ts'
import type { OrderDeps, OrderPorts } from './order.interface.ts'
import { toPublicOrder } from './order.mapper.ts'
import type { OrderQuery } from './order.query.ts'
import type { OrderRepository } from './order.repository.ts'
import { assertCancellable, type OrderService } from './order.service.ts'

const tokenOf = (req: Request) => (typeof req.query.token === 'string' ? req.query.token : undefined)

/** Order handlers for the three audiences: admin, signed-in customer, lookup-link holder. */
export class OrderController {
  constructor(
    private readonly deps: OrderDeps & { storage: Storage },
    private readonly service: OrderService,
    private readonly query: OrderQuery,
    private readonly repo: OrderRepository,
    private readonly ports: Pick<OrderPorts, 'gatewayPayments' | 'remainder'>,
  ) {}

  /** The order id for the URL code; 404 before any input is read, as the routes always did. */
  private async orderIdOf(req: Request) {
    const order = await this.repo.findIdByCode(this.deps.prisma, String(req.params.code))
    if (!order) throw orderNotFound()
    return order.id
  }

  private async respondAdminOrder(req: Request, res: Response) {
    const body: AdminOrder = await this.query.loadAdminOrder(String(req.params.code))
    res.json(body)
  }

  // ===== Admin =====

  adminList = async (_req: Request, res: Response) => {
    const body: AdminOrderPage = await this.query.listAdminOrders(dtoOf(res, AdminOrderQueryDto))
    res.json(body)
  }

  adminDetail = async (req: Request, res: Response) => {
    await this.respondAdminOrder(req, res)
  }

  /** The customer called to cancel: already cancelled returns the current order and writes nothing. */
  adminCancel = async (req: Request, res: Response) => {
    await this.service.cancelByStaff(await this.orderIdOf(req), contextOf(req), req.log)
    await this.respondAdminOrder(req, res)
  }

  adminCancelPaid = async (req: Request, res: Response) => {
    const input = dtoOf(res, CancelPaidOrderDto)
    await this.service.cancelPaidByStaff(await this.orderIdOf(req), contextOf(req), input, req.log)
    await this.respondAdminOrder(req, res)
  }

  /** A fulfillment transition: find the order (404), then read the body (400), then change and audit. */
  private fulfill =
    (step: (orderId: string, ctx: RequestContext, req: Request) => Promise<void>) =>
    async (req: Request, res: Response) => {
      await step(await this.orderIdOf(req), contextOf(req), req)
      await this.respondAdminOrder(req, res)
    }

  prepare = this.fulfill((id, ctx) => this.service.prepare(id, ctx))
  handOver = this.fulfill((id, ctx, req) => this.service.handOver(id, ctx, parse(HandoverDto, req.body)))
  deliver = this.fulfill((id, ctx) => this.service.deliver(id, ctx))
  failDelivery = this.fulfill((id, ctx) => this.service.failDelivery(id, ctx))
  redeliver = this.fulfill((id, ctx, req) => this.service.redeliver(id, ctx, parse(RedeliverDto, req.body)))
  returnToStock = this.fulfill((id, ctx, req) => this.service.returnToStock(id, ctx, parse(ReturnToStockDto, req.body)))
  restockForRedelivery = this.fulfill((id, ctx) => this.service.restockForRedelivery(id, ctx))

  // ===== Signed-in customer (`customer_id` is theirs) =====

  accountList = async (req: Request, res: Response) => {
    const body: AccountOrderPage = await this.query.listCustomerOrders(
      authSubject(req),
      dtoOf(res, AccountOrderQueryDto),
    )
    res.set('Cache-Control', 'no-store').json(body)
  }

  accountDetail = async (req: Request, res: Response) => {
    const order = await this.query.findCustomerOrder(this.deps.prisma, String(req.params.code), authSubject(req))
    const body: PublicOrder = toPublicOrder(this.deps.storage, order)
    res.set('Cache-Control', 'no-store').json(body)
  }

  /** Pay the remaining balance of your own pre-order; also issues a lookup token for the payment result page. */
  accountPayRemainder = async (req: Request, res: Response) => {
    const order = await this.query.findCustomerOrder(this.deps.prisma, String(req.params.code), authSubject(req))
    const { prisma, payments, siteUrl } = this.deps
    const body: PayRemainderResult = await this.ports.remainder.createLink(
      prisma,
      { payments, siteUrl, req },
      order.id,
      {
        issueToken: true,
      },
    )
    res.set('Cache-Control', 'no-store').json(body)
  }

  /** The customer cancels their own unpaid order; someone else's order or an unknown code is 404. */
  accountCancel = async (req: Request, res: Response) => {
    const customerId = authSubject(req)
    const code = String(req.params.code)
    const order = await this.query.findCustomerOrder(this.deps.prisma, code, customerId)
    assertCancellable(await this.service.cancel(order.id, { reason: 'customer', customerId }))
    const body: PublicOrder = toPublicOrder(
      this.deps.storage,
      await this.query.findCustomerOrder(this.deps.prisma, code, customerId),
    )
    res.set('Cache-Control', 'no-store').json(body)
  }

  // ===== Lookup link (no sign-in): view, cancel unpaid, pay the remainder =====

  publicDetail = async (req: Request, res: Response) => {
    const { prisma, emails, siteUrl, payments, storage } = this.deps
    const token = tokenOf(req)
    const code = String(req.params.code)
    let order = await this.query.findByToken(prisma, code, token)

    // Payment result page: ask the gateway for payments, in case the callback is late or missing. Over the limit the
    // customer still sees the order; only the gateway query is skipped.
    if (
      req.query.refresh === '1' &&
      (await withinRateLimit(prisma, RATE_LIMITS.paymentRefreshPerOrder, String(order.code)))
    ) {
      try {
        await this.ports.gatewayPayments.record({ prisma, emails, siteUrl, payments }, order)
        order = await this.query.findByToken(prisma, code, token)
      } catch (err) {
        // On gateway errors the customer still sees the order as is; the callback or a reload will record it.
        req.log.error({ err, orderCode: order.code }, 'Không truy vấn được cổng thanh toán')
      }
    }

    const body: PublicOrder = toPublicOrder(storage, order)
    // Personal data: no proxy or browser caching.
    res.set('Cache-Control', 'no-store').json(body)
  }

  /** Arrived pre-orders: remaining-balance link. Link holders can pay, as they can cancel unpaid orders. */
  publicPayRemainder = async (req: Request, res: Response) => {
    const { prisma, payments, siteUrl } = this.deps
    const order = await this.query.findByToken(prisma, String(req.params.code), tokenOf(req))
    const body: PayRemainderResult = await this.ports.remainder.createLink(prisma, { payments, siteUrl, req }, order.id)
    res.set('Cache-Control', 'no-store').json(body)
  }

  publicCancel = async (req: Request, res: Response) => {
    const token = tokenOf(req)
    const code = String(req.params.code)
    const order = await this.query.findByToken(this.deps.prisma, code, token)
    // The link holder is not always the buyer, so the event is tied to no customer account.
    assertCancellable(await this.service.cancel(order.id, { reason: 'customer' }))
    const body: PublicOrder = toPublicOrder(
      this.deps.storage,
      await this.query.findByToken(this.deps.prisma, code, token),
    )
    res.set('Cache-Control', 'no-store').json(body)
  }
}
