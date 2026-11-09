import { randomUUID } from 'node:crypto'
import { Router, type Response } from 'express'
import {
  ErrorCode,
  SimulatedExpiryRequest,
  SimulatedPaymentRequest,
  ZaloPayCallback,
  ZaloPayCallbackData,
  type ZaloPayCallbackResult,
} from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import { assertCancellable, expireOrder } from '../orders/cancel-order.ts'
import { SimulatorPaymentGateway } from '../payments/gateway.ts'
import { recordPayment } from '../payments/record-payment.ts'
import { isValidZaloPayCallback, orderCodeFromAppTransId } from '../payments/zalopay.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')

/** ZaloPay đọc kết quả trong body, luôn với HTTP 200. */
const reply = (res: Response, body: ZaloPayCallbackResult) => res.json(body)

/** Cổng thanh toán báo tiền về, không cần đăng nhập. */
export function paymentRoutes({ prisma, emails, siteUrl, payments, zalopayCallbackKey, logger }: AppDeps) {
  const router = Router()
  const recordDeps = { prisma, emails, siteUrl }

  if (zalopayCallbackKey) {
    router.post('/zalopay/callback', async (req, res) => {
      const callback = ZaloPayCallback.safeParse(req.body)
      // Kiểm MAC trên chuỗi `data` gốc trước khi đọc gì khác.
      if (!callback.success || !isValidZaloPayCallback(callback.data.data, callback.data.mac, zalopayCallbackKey)) {
        req.log.warn('Callback ZaloPay sai MAC')
        return reply(res, { return_code: -1, return_message: 'mac not equal' })
      }
      try {
        const raw: unknown = JSON.parse(callback.data.data)
        const data = ZaloPayCallbackData.parse(raw)
        const orderCode = orderCodeFromAppTransId(data.app_trans_id)
        const outcome = orderCode
          ? await recordPayment(recordDeps, {
              orderCode,
              amount: data.amount,
              reference: String(data.zp_trans_id),
              paidAt: new Date(data.server_time),
              source: 'webhook',
              payload: raw as object,
            })
          : 'unknown_order'
        req.log.info({ appTransId: data.app_trans_id, zpTransId: data.zp_trans_id, outcome }, 'Callback thanh toán')
        // Đã ghi từ trước hay mã đơn lạ cũng là đã nhận: ZaloPay không cần gửi lại.
        return reply(res, { return_code: 1, return_message: 'success' })
      } catch (err) {
        req.log.error({ err }, 'Không ghi nhận được callback ZaloPay')
        return reply(res, { return_code: 0, return_message: 'retry' })
      }
    })
  }

  // Chỉ có khi API chạy cổng giả lập (local, smoke): đi trọn luồng mua mà không có tiền thật.
  if (payments instanceof SimulatorPaymentGateway) {
    router.post('/simulator/paid', async (req, res) => {
      const input = parse(SimulatedPaymentRequest, req.body)
      const outcome = await recordPayment(recordDeps, {
        orderCode: input.orderCode,
        amount: input.amount,
        reference: `SIM-${input.orderCode}-${randomUUID()}`,
        paidAt: new Date(),
        source: 'simulator',
        payload: input,
      })
      if (outcome === 'unknown_order') throw notFound()
      res.status(204).end()
    })

    // Hết hạn ngay, không chờ 15 phút: cùng hàm với job hết hạn, chỉ bỏ điều kiện đã quá hạn.
    router.post('/simulator/expired', async (req, res) => {
      const { orderCode } = parse(SimulatedExpiryRequest, req.body)
      const order = await prisma.order.findUnique({ where: { code: orderCode }, select: { id: true } })
      if (!order) throw notFound()
      assertCancellable(await expireOrder({ ...recordDeps, payments, logger }, order.id))
      res.status(204).end()
    })
  }

  return router
}
