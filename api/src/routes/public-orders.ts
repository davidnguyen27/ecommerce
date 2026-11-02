import { Router } from 'express'
import type { PublicOrder } from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { findOrderByToken, toPublicOrder } from '../orders/orders.ts'
import { recordPayment } from '../payments/record-payment.ts'

/** Đơn hàng qua link có token tra cứu, không cần đăng nhập. */
export function publicOrderRoutes({ prisma, storage, emails, siteUrl, payments }: AppDeps) {
  return Router().get('/:code', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const code = String(req.params.code)
    let order = await findOrderByToken(prisma, code, token)

    // Trang kết quả thanh toán: hỏi cổng các khoản đã về, phòng khi webhook tới chậm hoặc không tới.
    if (req.query.refresh === '1') {
      try {
        const info = await payments.getPayment(order.code)
        for (const t of info.transactions) {
          await recordPayment(
            { prisma, emails, siteUrl },
            {
              orderCode: order.code,
              amount: t.amount,
              reference: t.reference,
              paidAt: t.paidAt,
              source: 'query',
              payload: { ...t, paidAt: t.paidAt.toISOString() },
            },
          )
        }
        order = await findOrderByToken(prisma, code, token)
      } catch (err) {
        // Cổng lỗi thì khách vẫn thấy đơn như hiện có; webhook hoặc lần tải sau sẽ ghi nhận.
        req.log.error({ err, orderCode: order.code }, 'Không truy vấn được cổng thanh toán')
      }
    }

    const body: PublicOrder = toPublicOrder(storage, order)
    // Dữ liệu cá nhân: không để proxy hay trình duyệt lưu lại.
    res.set('Cache-Control', 'no-store').json(body)
  })
}
