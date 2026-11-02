import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { ErrorCode, PayosWebhook, SimulatedPaymentRequest } from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import { SimulatorPaymentGateway } from '../payments/gateway.ts'
import { isValidPayosSignature, parsePayosDateTime } from '../payments/payos.ts'
import { recordPayment } from '../payments/record-payment.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Cổng thanh toán báo tiền về, không cần đăng nhập. */
export function paymentRoutes({ prisma, emails, siteUrl, payments, payosChecksumKey }: AppDeps) {
  const router = Router()
  const recordDeps = { prisma, emails, siteUrl }

  if (payosChecksumKey) {
    router.post('/payos/webhook', async (req, res) => {
      const raw: unknown = req.body
      // Kiểm chữ ký trên `data` gốc, đủ mọi trường PayOS gửi, trước khi đọc gì khác.
      const signed =
        isRecord(raw) &&
        isRecord(raw.data) &&
        typeof raw.signature === 'string' &&
        isValidPayosSignature(raw.data, raw.signature, payosChecksumKey)
      if (!signed) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Chữ ký webhook không hợp lệ')
      const { code, data } = parse(PayosWebhook, raw)

      if (code === '00' && data.code === '00') {
        const outcome = await recordPayment(recordDeps, {
          orderCode: data.orderCode,
          amount: data.amount,
          reference: data.reference,
          paidAt: parsePayosDateTime(data.transactionDateTime) ?? new Date(),
          source: 'webhook',
          payload: raw as object,
        })
        req.log.info({ orderCode: data.orderCode, reference: data.reference, outcome }, 'Webhook thanh toán')
      }
      // PayOS cần 2xx, kể cả khi khoản này đã ghi từ trước hay là webhook thử với mã đơn lạ.
      res.json({ success: true })
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
      if (outcome === 'unknown_order') throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')
      res.status(204).end()
    })
  }

  return router
}
