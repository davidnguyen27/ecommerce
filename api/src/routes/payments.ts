import { randomUUID } from 'node:crypto'
import { Router, type Request } from 'express'
import {
  ErrorCode,
  SimulatedExpiryRequest,
  SimulatedPaymentRequest,
  VnpayIpnQuery,
  type VnpayIpnResult,
} from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import type { PaymentSource } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import { assertCancellable, expireOrder } from '../orders/cancel-order.ts'
import { SimulatorPaymentGateway } from '../payments/gateway.ts'
import { recordPayment } from '../payments/record-payment.ts'
import { isValidVnpaySignature, isVnpaySuccess, parseTxnRef, parseVnDateTime } from '../payments/vnpay.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')

/** Cổng thanh toán báo tiền về, không cần đăng nhập. */
export function paymentRoutes({ prisma, emails, siteUrl, payments, vnpayHashSecret, logger }: AppDeps) {
  const router = Router()
  const recordDeps = { prisma, emails, siteUrl }

  if (vnpayHashSecret) {
    /**
     * Kết quả thanh toán VNPAY có chữ ký, từ IPN hay từ trang quay về: cùng bộ tham số, cùng chữ ký, ghi qua cùng
     * `recordPayment` nên về trùng chỉ ghi một lần. Mã trả lời theo ADR 0010.
     */
    const recordVnpayResult = async (
      req: Request,
      raw: Record<string, unknown>,
      source: PaymentSource,
    ): Promise<VnpayIpnResult> => {
      // Kiểm chữ ký trên toàn bộ tham số gốc trước khi đọc gì khác.
      if (!isValidVnpaySignature(raw, vnpayHashSecret)) {
        req.log.warn({ source }, 'Kết quả VNPAY sai chữ ký')
        return { RspCode: '97', Message: 'Invalid signature' }
      }
      const parsed = VnpayIpnQuery.safeParse(raw)
      const ref = parsed.success ? parseTxnRef(parsed.data.vnp_TxnRef) : null
      if (!parsed.success || !ref) {
        req.log.warn({ source, txnRef: raw.vnp_TxnRef }, 'Kết quả VNPAY cho mã giao dịch lạ')
        return { RspCode: '01', Message: 'Order not found' }
      }
      const data = parsed.data
      if (!isVnpaySuccess(data)) {
        // Khách hủy, thẻ lỗi, hết hạn...: không có tiền về, đơn giữ nguyên chờ thanh toán.
        req.log.info(
          { source, txnRef: data.vnp_TxnRef, responseCode: data.vnp_ResponseCode, status: data.vnp_TransactionStatus },
          'VNPAY: giao dịch không thành công',
        )
        return { RspCode: '00', Message: 'Confirm Success' }
      }
      try {
        const outcome = await recordPayment(recordDeps, {
          orderCode: ref.orderCode,
          amount: Number(data.vnp_Amount) / 100,
          reference: data.vnp_TransactionNo,
          paidAt: (data.vnp_PayDate && parseVnDateTime(data.vnp_PayDate)) || new Date(),
          source,
          payload: raw as object,
        })
        req.log.info(
          { source, txnRef: data.vnp_TxnRef, transactionNo: data.vnp_TransactionNo, outcome },
          'Kết quả thanh toán VNPAY',
        )
        if (outcome === 'unknown_order') return { RspCode: '01', Message: 'Order not found' }
        if (outcome === 'duplicate') return { RspCode: '02', Message: 'Order already confirmed' }
        // `paid`, hay `flagged` (lệch tiền, trả sau khi hủy) đã vào đối soát: gửi lại cũng không đổi gì.
        return { RspCode: '00', Message: 'Confirm Success' }
      } catch (err) {
        req.log.error({ err, source }, 'Không ghi nhận được kết quả VNPAY')
        return { RspCode: '99', Message: 'Unknown error' }
      }
    }

    // IPN: VNPAY gọi server bằng GET, tham số trong query; kết quả đọc trong body JSON.
    router.get('/vnpay/ipn', async (req, res) => {
      res.json(await recordVnpayResult(req, req.query as Record<string, unknown>, 'webhook'))
    })

    // Trang quay về: VNPAY gửi kèm cùng bộ tham số có chữ ký trên URL; trang kết quả chuyển lại cho API. Người dùng
    // chốt 2026-11-12 vì `querydr` của sandbox lỗi và IPN cần tunnel (ADR 0010). Chữ ký chỉ VNPAY và hệ thống tạo
    // được, nên an toàn như IPN; không cần token đơn.
    router.post('/vnpay/return', async (req, res) => {
      const body: unknown = req.body
      const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
      res.json(await recordVnpayResult(req, raw, 'return'))
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
