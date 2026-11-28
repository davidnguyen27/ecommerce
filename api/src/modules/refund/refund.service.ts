import type { ManualRefundRequest, RetryRefundRequest, SettleRefundRequest } from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { z } from 'zod'
import type { PaymentGateway } from '../../core/adapters/payment/gateway.ts'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import type { CustomerMail } from '../../core/jobs/queues.ts'
import { executeGatewayRefund } from './refund-gateway.ts'
import { executeManualRefund, retryRefund, settleRefund } from './refund-record.ts'

/** Refund execution (ADR 0014). Each action returns the order code, for the caller to show the order. */
export class RefundService {
  constructor(
    private readonly prisma: Db,
    private readonly payments: PaymentGateway,
    private readonly mail: CustomerMail,
  ) {}

  manual(refundId: string, input: z.output<typeof ManualRefundRequest>, ctx: RequestContext) {
    return audited(this.prisma, ctx, (tx, audit) =>
      executeManualRefund(tx, this.mail, audit, refundId, ctx.staffId, input),
    )
  }

  /** Sends the refund to the gateway; a gateway error is logged and the refund stays for retry. */
  viaGateway(refundId: string, ctx: RequestContext, log: Logger) {
    const { prisma, payments, mail } = this
    return executeGatewayRefund({ prisma, payments, mail }, ctx, log, refundId, ctx.staffId)
  }

  settle(refundId: string, input: z.output<typeof SettleRefundRequest>, ctx: RequestContext) {
    return audited(this.prisma, ctx, (tx, audit) => settleRefund(tx, this.mail, audit, refundId, ctx.staffId, input))
  }

  retry(refundId: string, input: z.output<typeof RetryRefundRequest>, ctx: RequestContext) {
    return audited(this.prisma, ctx, (tx, audit) => retryRefund(tx, audit, refundId, ctx.staffId, input))
  }
}
