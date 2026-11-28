import { randomUUID } from 'node:crypto'
import { ErrorCode, VnpayIpnQuery, type SimulatedPaymentRequest, type VnpayIpnResult } from '@ecommerce/shared'
import type { Logger } from 'pino'
import {
  isValidVnpaySignature,
  isVnpaySuccess,
  parseTxnRef,
  parseVnDateTime,
} from '../../core/adapters/payment/vnpay.ts'
import type { Db } from '../../core/db.ts'
import { AppError } from '../../core/errors.ts'
import type { CustomerMail } from '../../core/jobs/jobs.ts'
import type { PaymentSource } from '../../generated/prisma/client.ts'
import { assertCancellable, type IOrderService } from '../order/index.ts'
import { recordPayment } from './payment-record.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')

/** Money the gateway reports (IPN, return page) and the simulator used locally and in smoke runs. */
export class PaymentService {
  constructor(
    private readonly prisma: Db,
    private readonly mail: CustomerMail,
    private readonly orders: Pick<IOrderService, 'expire'>,
  ) {}

  private get recordDeps() {
    return { prisma: this.prisma, ...this.mail }
  }

  /**
   * Signed VNPAY payment results, from IPN or the return page: same params, same signature, recorded through the same
   * `recordPayment`, so duplicates are written once. Response codes per ADR 0010.
   */
  async recordVnpayResult(
    hashSecret: string,
    raw: Record<string, unknown>,
    source: PaymentSource,
    log: Logger,
  ): Promise<VnpayIpnResult> {
    // Check the signature over all original params before reading anything else.
    if (!isValidVnpaySignature(raw, hashSecret)) {
      log.warn({ source }, 'Kết quả VNPAY sai chữ ký')
      return { RspCode: '97', Message: 'Invalid signature' }
    }
    const parsed = VnpayIpnQuery.safeParse(raw)
    const ref = parsed.success ? parseTxnRef(parsed.data.vnp_TxnRef) : null
    if (!parsed.success || !ref) {
      log.warn({ source, txnRef: raw.vnp_TxnRef }, 'Kết quả VNPAY cho mã giao dịch lạ')
      return { RspCode: '01', Message: 'Order not found' }
    }
    const data = parsed.data
    if (!isVnpaySuccess(data)) {
      // Customer cancelled, card error, expired…: no money, the order stays pending.
      log.info(
        { source, txnRef: data.vnp_TxnRef, responseCode: data.vnp_ResponseCode, status: data.vnp_TransactionStatus },
        'VNPAY: giao dịch không thành công',
      )
      return { RspCode: '00', Message: 'Confirm Success' }
    }
    try {
      const outcome = await recordPayment(this.recordDeps, {
        orderCode: ref.orderCode,
        amount: Number(data.vnp_Amount) / 100,
        reference: data.vnp_TransactionNo,
        gatewayReference: data.vnp_TxnRef,
        paidAt: (data.vnp_PayDate && parseVnDateTime(data.vnp_PayDate)) || new Date(),
        source,
        payload: raw as object,
      })
      log.info(
        { source, txnRef: data.vnp_TxnRef, transactionNo: data.vnp_TransactionNo, outcome },
        'Kết quả thanh toán VNPAY',
      )
      if (outcome === 'unknown_order') return { RspCode: '01', Message: 'Order not found' }
      if (outcome === 'duplicate') return { RspCode: '02', Message: 'Order already confirmed' }
      // `paid`, or `flagged` (amount mismatch, paid after cancel) already in reconciliation: resending changes nothing.
      return { RspCode: '00', Message: 'Confirm Success' }
    } catch (err) {
      log.error({ err, source }, 'Không ghi nhận được kết quả VNPAY')
      return { RspCode: '99', Message: 'Unknown error' }
    }
  }

  /** Simulator: the gateway reports a payment. */
  async simulatePaid(input: SimulatedPaymentRequest) {
    const outcome = await recordPayment(this.recordDeps, {
      orderCode: input.orderCode,
      amount: input.amount,
      reference: `SIM-${input.orderCode}-${randomUUID()}`,
      gatewayReference: input.gatewayReference,
      paidAt: new Date(),
      source: 'simulator',
      payload: input,
    })
    if (outcome === 'unknown_order') throw notFound()
  }

  /** Simulator: expire now instead of waiting 15 minutes, the same as the expiry job minus the overdue condition. */
  async simulateExpiry(orderCode: number) {
    const order = await this.prisma.order.findUnique({ where: { code: orderCode }, select: { id: true } })
    if (!order) throw notFound()
    assertCancellable(await this.orders.expire(order.id))
  }
}
