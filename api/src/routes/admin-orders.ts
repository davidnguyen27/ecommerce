import { Router } from 'express'
import { ErrorCode } from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'
import { assertCancellable, cancelInTransaction, cancelPaymentLink } from '../orders/cancel-order.ts'
import type { PaymentGateway } from '../payments/gateway.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')

/** Đơn hàng ở trang quản trị. Ticket 07 thêm danh sách và chi tiết. */
export function adminOrderRoutes(prisma: Db, payments: PaymentGateway) {
  return Router().post('/:code/cancel', requirePermission('order.fulfill'), async (req, res) => {
    const code = String(req.params.code)
    const order = /^\d{1,9}$/.test(code)
      ? await prisma.order.findUnique({ where: { code: Number(code) }, select: { id: true, code: true } })
      : null
    if (!order) throw notFound()

    // Khách gọi điện báo thôi: nhân viên hủy hộ, cùng hàm với hết hạn và khách tự hủy, audit trong cùng transaction.
    const outcome = await audited(prisma, req, async (tx, audit) => {
      const result = await cancelInTransaction(tx, order.id, { reason: 'staff', staffId: currentStaff(req).id })
      if (result === 'cancelled') {
        await audit({
          action: 'order.cancel',
          entityType: 'order',
          entityId: order.id,
          before: { status: 'pending_payment' },
          after: { status: 'cancelled', cancelReason: 'staff' },
        })
      }
      return result
    })
    assertCancellable(outcome)
    if (outcome === 'cancelled') await cancelPaymentLink({ payments, logger: req.log }, order.code)
    res.status(204).end()
  })
}
