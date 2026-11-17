import { Router, type Response } from 'express'
import { ManualRefundRequest, RetryRefundRequest, SettleRefundRequest, type AdminOrder } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { parse } from '../http/validation.ts'
import { loadAdminOrder } from '../orders/admin-order.ts'
import type { PaymentGateway } from '../payments/gateway.ts'
import { executeGatewayRefund } from '../payments/gateway-refund.ts'
import { executeManualRefund, retryRefund, settleRefund } from '../payments/refunds.ts'
import type { CustomerMail } from '../jobs/jobs.ts'

/**
 * Thực hiện hoàn tiền (ADR 0014), mount tại `/refunds`; mọi thao tác cần `payment.refund`. Mỗi thao tác trả lại chi tiết
 * đơn để trang quản trị thay đơn đang hiện bằng response. Xem khoản hoàn nằm trong chi tiết đơn (`order.view`).
 */
export function adminRefundRoutes(prisma: Db, storage: Storage, payments: PaymentGateway, mail: CustomerMail) {
  const respond = async (res: Response, code: number) => {
    const body: AdminOrder = await loadAdminOrder(prisma, storage, payments, String(code))
    res.json(body)
  }
  return Router()
    .use(requirePermission('payment.refund'))
    .post('/:id/manual', async (req, res) => {
      const input = parse(ManualRefundRequest, req.body)
      const staffId = currentStaff(req).id
      const code = await audited(prisma, req, (tx, audit) =>
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
      const code = await audited(prisma, req, (tx, audit) =>
        settleRefund(tx, mail, audit, String(req.params.id), staffId, input),
      )
      await respond(res, code)
    })
    .post('/:id/retry', async (req, res) => {
      const input = parse(RetryRefundRequest, req.body)
      const staffId = currentStaff(req).id
      const code = await audited(prisma, req, (tx, audit) =>
        retryRefund(tx, audit, String(req.params.id), staffId, input),
      )
      await respond(res, code)
    })
}
