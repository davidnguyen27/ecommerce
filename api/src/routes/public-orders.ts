import { Router } from 'express'
import type { PayRemainderResult, PublicOrder } from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { createRemainderLink } from '../preorders/remainder.ts'
import { assertCancellable, cancelOrder } from '../orders/cancel-order.ts'
import { findOrderByToken, toPublicOrder } from '../orders/orders.ts'
import { recordGatewayPayments } from '../payments/record-payment.ts'

/** Đơn hàng qua link có token tra cứu, không cần đăng nhập. Token cho xem, hủy đơn chưa thanh toán và trả phần còn lại. */
export function publicOrderRoutes({ prisma, storage, emails, siteUrl, payments, logger }: AppDeps) {
  const tokenOf = (query: Record<string, unknown>) => (typeof query.token === 'string' ? query.token : undefined)

  return (
    Router()
      .get('/:code', async (req, res) => {
        const token = tokenOf(req.query)
        const code = String(req.params.code)
        let order = await findOrderByToken(prisma, code, token)

        // Trang kết quả thanh toán: hỏi cổng các khoản đã về, phòng khi callback tới chậm hoặc không tới.
        if (req.query.refresh === '1') {
          try {
            await recordGatewayPayments({ prisma, emails, siteUrl, payments }, order)
            order = await findOrderByToken(prisma, code, token)
          } catch (err) {
            // Cổng lỗi thì khách vẫn thấy đơn như hiện có; callback hoặc lần tải sau sẽ ghi nhận.
            req.log.error({ err, orderCode: order.code }, 'Không truy vấn được cổng thanh toán')
          }
        }

        const body: PublicOrder = toPublicOrder(storage, order)
        // Dữ liệu cá nhân: không để proxy hay trình duyệt lưu lại.
        res.set('Cache-Control', 'no-store').json(body)
      })
      // Đơn đặt trước đã về hàng: link trả phần còn lại. Người cầm link tra cứu trả được, như hủy đơn chưa thanh toán.
      .post('/:code/pay-remainder', async (req, res) => {
        const order = await findOrderByToken(prisma, String(req.params.code), tokenOf(req.query))
        const body: PayRemainderResult = await createRemainderLink(prisma, { payments, siteUrl, req }, order.id)
        res.set('Cache-Control', 'no-store').json(body)
      })
      .post('/:code/cancel', async (req, res) => {
        const token = tokenOf(req.query)
        const code = String(req.params.code)
        const order = await findOrderByToken(prisma, code, token)
        // Người có link không phải lúc nào cũng là người đặt, nên sự kiện không gắn tài khoản khách nào.
        assertCancellable(await cancelOrder({ prisma, payments, logger }, order.id, { reason: 'customer' }))

        const body: PublicOrder = toPublicOrder(storage, await findOrderByToken(prisma, code, token))
        res.set('Cache-Control', 'no-store').json(body)
      })
  )
}
