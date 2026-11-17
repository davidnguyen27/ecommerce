import { Router } from 'express'
import { ManualRefundRequest, RetryRefundRequest, SettleRefundRequest, type AdminOrder } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { parse } from '../http/validation.ts'
import { loadAdminOrder } from '../orders/admin-order.ts'
import { executeManualRefund, retryRefund, settleRefund, type RefundMail } from '../payments/refunds.ts'

/**
 * Thực hiện hoàn tiền (ADR 0014), mount tại `/refunds`; mọi thao tác cần `payment.refund`. Mỗi thao tác trả lại chi tiết
 * đơn để trang quản trị thay đơn đang hiện bằng response. Xem khoản hoàn nằm trong chi tiết đơn (`order.view`).
 */
export function adminRefundRoutes(prisma: Db, storage: Storage, mail: RefundMail) {
  const respond = async (res: { json: (body: AdminOrder) => void }, code: number) => {
    res.json(await loadAdminOrder(prisma, storage, String(code)))
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
