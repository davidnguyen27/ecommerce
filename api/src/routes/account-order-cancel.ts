import { Router } from 'express'
import { ErrorCode, type PublicOrder } from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { authSubject } from '../auth/require-auth.ts'
import { AppError } from '../http/errors.ts'
import { assertCancellable, cancelOrder } from '../orders/cancel-order.ts'
import { ORDER_VIEW_INCLUDE, toPublicOrder } from '../orders/orders.ts'

/** Đơn của chính khách đang đăng nhập; đơn của người khác hay mã lạ đều là 404. */
async function findOwnOrder({ prisma }: Pick<AppDeps, 'prisma'>, customerId: string, code: string) {
  const order = /^\d{1,9}$/.test(code)
    ? await prisma.order.findFirst({ where: { code: Number(code), customerId }, include: ORDER_VIEW_INCLUDE })
    : null
  if (!order) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')
  return order
}

/** Khách hủy đơn chưa thanh toán trong tài khoản; đã đi qua `requireAuth` audience customer. */
export function accountOrderCancelRoutes(deps: AppDeps) {
  const { prisma, storage, payments, logger } = deps
  return Router().post('/:code/cancel', async (req, res) => {
    const customerId = authSubject(req)
    const code = String(req.params.code)
    const order = await findOwnOrder(deps, customerId, code)
    assertCancellable(await cancelOrder({ prisma, payments, logger }, order.id, { reason: 'customer', customerId }))

    const body: PublicOrder = toPublicOrder(storage, await findOwnOrder(deps, customerId, code))
    res.set('Cache-Control', 'no-store').json(body)
  })
}
