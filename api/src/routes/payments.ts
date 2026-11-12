import { randomUUID } from 'node:crypto'
import { Router, type Response } from 'express'
import {
  ErrorCode,
  SimulatedExpiryRequest,
  SimulatedPaymentRequest,
  VnpayIpnQuery,
  type VnpayIpnResult,
} from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import { assertCancellable, expireOrder } from '../orders/cancel-order.ts'
import { SimulatorPaymentGateway } from '../payments/gateway.ts'
import { recordPayment } from '../payments/record-payment.ts'
import { isValidVnpaySignature, isVnpaySuccess, parseTxnRef, parseVnDateTime } from '../payments/vnpay.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')

/** VNPAY đọc kết quả IPN trong body JSON. */
const reply = (res: Response, body: VnpayIpnResult) => res.json(body)

/** Cổng thanh toán báo tiền về, không cần đăng nhập. */
export function paymentRoutes({ prisma, emails, siteUrl, payments, vnpayHashSecret, logger }: AppDeps) {
  const router = Router()
  const recordDeps = { prisma, emails, siteUrl }

  if (vnpayHashSecret) {
    // IPN của VNPAY: GET, tham số trong query. Mã trả lời theo ADR 0010.
    router.get('/vnpay/ipn', async (req, res) => {
      const raw = req.query as Record<string, unknown>
      // Kiểm chữ ký trên toàn bộ tham số gốc trước khi đọc gì khác.
      if (!isValidVnpaySignature(raw, vnpayHashSecret)) {
        req.log.warn('IPN VNPAY sai chữ ký')
        return reply(res, { RspCode: '97', Message: 'Invalid signature' })
      }
      const ipn = VnpayIpnQuery.safeParse(raw)
      const ref = ipn.success ? parseTxnRef(ipn.data.vnp_TxnRef) : null
      if (!ipn.success || !ref) {
        req.log.warn({ txnRef: raw.vnp_TxnRef }, 'IPN VNPAY cho mã giao dịch lạ')
        return reply(res, { RspCode: '01', Message: 'Order not found' })
      }
      const data = ipn.data
      if (!isVnpaySuccess(data)) {
        // Khách hủy, thẻ lỗi, hết hạn...: không có tiền về, đơn giữ nguyên chờ thanh toán.
        req.log.info(
          { txnRef: data.vnp_TxnRef, responseCode: data.vnp_ResponseCode, status: data.vnp_TransactionStatus },
          'IPN VNPAY: giao dịch không thành công',
        )
        return reply(res, { RspCode: '00', Message: 'Confirm Success' })
      }
      try {
        const outcome = await recordPayment(recordDeps, {
          orderCode: ref.orderCode,
          amount: Number(data.vnp_Amount) / 100,
          reference: data.vnp_TransactionNo,
          paidAt: (data.vnp_PayDate && parseVnDateTime(data.vnp_PayDate)) || new Date(),
          source: 'webhook',
          payload: raw as object,
        })
        req.log.info({ txnRef: data.vnp_TxnRef, transactionNo: data.vnp_TransactionNo, outcome }, 'IPN thanh toán')
        if (outcome === 'unknown_order') return reply(res, { RspCode: '01', Message: 'Order not found' })
        if (outcome === 'duplicate') return reply(res, { RspCode: '02', Message: 'Order already confirmed' })
        // `paid`, hay `flagged` (lệch tiền, trả sau khi hủy) đã vào đối soát: gửi lại cũng không đổi gì.
        return reply(res, { RspCode: '00', Message: 'Confirm Success' })
      } catch (err) {
        req.log.error({ err }, 'Không ghi nhận được IPN VNPAY')
        return reply(res, { RspCode: '99', Message: 'Unknown error' })
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
