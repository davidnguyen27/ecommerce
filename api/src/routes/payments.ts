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
import { AppError } from '../core/errors.ts'
import { parse } from '../core/middleware/validation.ts'
import { assertCancellable, expireOrder } from '../orders/cancel-order.ts'
import { SimulatorPaymentGateway } from '../payments/gateway.ts'
import { recordPayment } from '../payments/record-payment.ts'
import { isValidVnpaySignature, isVnpaySuccess, parseTxnRef, parseVnDateTime } from '../payments/vnpay.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')

/** The payment gateway reports money; no sign-in. */
export function paymentRoutes({ prisma, emails, siteUrl, payments, vnpayHashSecret, logger }: AppDeps) {
  const router = Router()
  const recordDeps = { prisma, emails, siteUrl }

  if (vnpayHashSecret) {
    /**
     * Signed VNPAY payment results, from IPN or the return page: same params, same signature, recorded through the same
     * `recordPayment`, so duplicates are written once. Response codes per ADR 0010.
     */
    const recordVnpayResult = async (
      req: Request,
      raw: Record<string, unknown>,
      source: PaymentSource,
    ): Promise<VnpayIpnResult> => {
      // Check the signature over all original params before reading anything else.
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
        // Customer cancelled, card error, expired…: no money, the order stays pending.
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
          gatewayReference: data.vnp_TxnRef,
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
        // `paid`, or `flagged` (amount mismatch, paid after cancel) already in reconciliation: resending changes
        // nothing.
        return { RspCode: '00', Message: 'Confirm Success' }
      } catch (err) {
        req.log.error({ err, source }, 'Không ghi nhận được kết quả VNPAY')
        return { RspCode: '99', Message: 'Unknown error' }
      }
    }

    // IPN: VNPAY calls the server with GET, params in the query; it reads the result from the JSON body.
    router.get('/vnpay/ipn', async (req, res) => {
      res.json(await recordVnpayResult(req, req.query as Record<string, unknown>, 'webhook'))
    })

    // Return page: VNPAY puts the same signed params on the URL; the result page forwards them to the API. Decided
    // 2026-11-12 since sandbox `querydr` fails and IPN needs a tunnel (ADR 0010). Only VNPAY and we can sign, so it is
    // as safe as IPN; no order token needed.
    router.post('/vnpay/return', async (req, res) => {
      const body: unknown = req.body
      const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
      res.json(await recordVnpayResult(req, raw, 'return'))
    })
  }

  // Only when the API runs the simulator (local, smoke): the full purchase flow without real money.
  if (payments instanceof SimulatorPaymentGateway) {
    router.post('/simulator/paid', async (req, res) => {
      const input = parse(SimulatedPaymentRequest, req.body)
      const outcome = await recordPayment(recordDeps, {
        orderCode: input.orderCode,
        amount: input.amount,
        reference: `SIM-${input.orderCode}-${randomUUID()}`,
        gatewayReference: input.gatewayReference,
        paidAt: new Date(),
        source: 'simulator',
        payload: input,
      })
      if (outcome === 'unknown_order') throw notFound()
      res.status(204).end()
    })

    // Expire now instead of waiting 15 minutes: the same function as the expiry job, minus the overdue condition.
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
