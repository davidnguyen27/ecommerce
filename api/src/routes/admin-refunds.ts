import { Router, type Response } from 'express'
import { ManualRefundRequest, RetryRefundRequest, SettleRefundRequest, type AdminOrder } from '@ecommerce/shared'
import type { Storage } from '../core/adapters/storage.ts'
import { audited } from '../core/audit/audited.ts'
import { currentStaff, requirePermission } from '../core/middleware/staff-context.ts'
import type { Db } from '../core/db.ts'
import { parse } from '../core/middleware/validation.ts'
import { createOrderQuery } from '../modules/order/index.ts'
import type { PaymentGateway } from '../payments/gateway.ts'
import { executeGatewayRefund } from '../payments/gateway-refund.ts'
import { executeManualRefund, retryRefund, settleRefund } from '../payments/refunds.ts'
import type { CustomerMail } from '../core/jobs/jobs.ts'
import { contextOf } from '../core/context/request-context.ts'

/**
 * Refund execution (ADR 0014), mounted at `/refunds`; everything needs `payment.refund`. Each action returns the order
 * detail for the admin page to swap in. Refunds are viewed in the order detail (`order.view`).
 */
export function adminRefundRoutes(prisma: Db, storage: Storage, payments: PaymentGateway, mail: CustomerMail) {
  const respond = async (res: Response, code: number) => {
    const body: AdminOrder = await createOrderQuery({ prisma, storage, payments }).loadAdminOrder(String(code))
    res.json(body)
  }
  return Router()
    .use(requirePermission('payment.refund'))
    .post('/:id/manual', async (req, res) => {
      const input = parse(ManualRefundRequest, req.body)
      const staffId = currentStaff(req).id
      const code = await audited(prisma, contextOf(req), (tx, audit) =>
        executeManualRefund(tx, mail, audit, String(req.params.id), staffId, input),
      )
      await respond(res, code)
    })
    .post('/:id/vnpay', async (req, res) => {
      const staffId = currentStaff(req).id
      const code = await executeGatewayRefund({ prisma, payments, mail }, req, String(req.params.id), staffId)
      await respond(res, code)
    })
    .post('/:id/settle', async (req, res) => {
      const input = parse(SettleRefundRequest, req.body)
      const staffId = currentStaff(req).id
      const code = await audited(prisma, contextOf(req), (tx, audit) =>
        settleRefund(tx, mail, audit, String(req.params.id), staffId, input),
      )
      await respond(res, code)
    })
    .post('/:id/retry', async (req, res) => {
      const input = parse(RetryRefundRequest, req.body)
      const staffId = currentStaff(req).id
      const code = await audited(prisma, contextOf(req), (tx, audit) =>
        retryRefund(tx, audit, String(req.params.id), staffId, input),
      )
      await respond(res, code)
    })
}
