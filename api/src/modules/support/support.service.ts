import {
  ErrorCode,
  SUPPORT_CLOSED_STATUSES,
  type AdminCreateSupportRequest,
  type AdminSupportPage,
  type AdminSupportQuery,
  type AdminSupportReply,
  type AdminSupportRequest,
  type DecideSupportRequest,
  type ExchangeOptions,
  type ProposeReturnRefund,
  type ReceiveSupportReturn,
  type RecordWarrantyMilestone,
  type RecordWarrantyOutcome,
  type ShipExchangeRequest,
} from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { z } from 'zod'
import { toMessageView } from '../chatbot/index.ts'
import type { Storage } from '../../core/adapters/storage.ts'
import { audited, type Audit } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { AppError, invalidField } from '../../core/errors.ts'
import type { CustomerMail } from '../../core/jobs/jobs.ts'
import { deleteSupportImageQuietly, storeSupportImage } from '../../core/media/support-images.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { exchangeOptions, shipExchange } from './support-exchange.ts'
import {
  assignSupportRequest,
  claimSupportRequest,
  createSupportRequest,
  findSupportCustomer,
  recordAttachment,
  staffReply,
  toAdminSupport,
  toAdminSupportSummary,
} from './support-request.ts'
import { decideSupportRequest, proposeReturnRefund, receiveSupportReturn, returnRefundHint } from './support-return.ts'
import { hasWarrantyCommitment, recordWarrantyMilestone, recordWarrantyOutcome } from './support-warranty.ts'
import type { SupportRepository } from './support.repository.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy yêu cầu')

/** A staff write in the audited transaction: the write function locks the request, checks, writes and audits. */
type Write = (tx: Prisma.TransactionClient, audit: Audit, staffId: string) => Promise<unknown>

/**
 * Admin support requests (spec M6b). Every write goes through `audited()` and the response is the request detail. The
 * chatbot transcript is the customer talking to the chatbot, like messages with support: only `support.handle` reads
 * it (spec M8); warehouse and accounting (`order.view`) opening the request do not see it.
 */
export class SupportService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: SupportRepository,
    private readonly storage: Storage,
    private readonly mail: CustomerMail,
  ) {}

  async list(query: z.output<typeof AdminSupportQuery>, staffId: string): Promise<AdminSupportPage> {
    const closed = [...SUPPORT_CLOSED_STATUSES]
    const status: Prisma.SupportRequestWhereInput =
      query.status === 'all'
        ? {}
        : query.status === 'open'
          ? { status: { notIn: closed } }
          : query.status === 'awaiting_staff'
            ? { status: { in: ['new', 'in_progress'] } }
            : { status: query.status }
    const where: Prisma.SupportRequestWhereInput = {
      ...status,
      ...(query.kind !== 'all' && { kind: query.kind }),
      ...(query.unassigned && { assigneeId: null }),
      ...(query.assignee && { assigneeId: query.assignee === 'me' ? staffId : query.assignee }),
      ...(query.orderCode !== undefined && { order: { code: query.orderCode } }),
      ...(query.exchangeOverdue && { exchangeOverdueAt: { not: null }, receivedAt: null }),
      ...(query.returnOverdue && { overdueDays: { gt: 0 } }),
    }
    const { requests, total } = await this.repo.adminPage(this.prisma, where, query)
    return { items: requests.map(toAdminSupportSummary), total, page: query.page, pageSize: query.pageSize }
  }

  async detail(code: number, readsTranscript: boolean): Promise<AdminSupportRequest> {
    const request = await this.repo.findByCode(this.prisma, code)
    if (!request) throw notFound()
    const conversation = readsTranscript ? await this.repo.chatConversation(this.prisma, request.id) : null
    return {
      ...(await toAdminSupport(this.storage, request)),
      returnRefund: await returnRefundHint(this.prisma, request),
      hasWarrantyCommitment: await hasWarrantyCommitment(this.prisma, request),
      chatTranscript: conversation ? conversation.messages.map(toMessageView) : null,
    }
  }

  /** Exchangeable variants per line of one order, for the create-on-behalf exchange page. */
  async exchangeOptions(orderCode: number): Promise<ExchangeOptions> {
    const order = Number.isInteger(orderCode) ? await this.repo.orderIdByCode(this.prisma, orderCode) : null
    if (!order) throw invalidField('orderCode', 'Không có đơn này')
    return exchangeOptions(this.prisma, order.id)
  }

  /** Creates a request on the customer's behalf, on an order or a customer account; returns its code. */
  create(input: AdminCreateSupportRequest, ctx: RequestContext): Promise<number> {
    return audited(this.prisma, ctx, async (tx, audit) => {
      const order = input.orderCode === undefined ? undefined : await this.repo.orderForRequest(tx, input.orderCode)
      if (input.orderCode !== undefined && !order) throw invalidField('orderCode', 'Không có đơn này')
      const customer = order ? undefined : await findSupportCustomer(tx, { email: input.customerEmail! })
      if (!order && !customer) throw invalidField('customerEmail', 'Không có tài khoản khách với email này')
      const request = await createSupportRequest(tx, this.mail, {
        kind: input.kind,
        subject: input.subject,
        message: input.message,
        lines: 'lines' in input ? input.lines : undefined,
        creator: { type: 'staff', staffId: ctx.staffId },
        ...(order ? { order } : { customer: customer! }),
      })
      await audit({
        action: 'support.create',
        entityType: 'support_request',
        entityId: request.id,
        after: { code: request.code, kind: request.kind, orderCode: order?.code ?? null, subject: input.subject },
      })
      return request.code
    })
  }

  private async write(ctx: RequestContext, run: Write) {
    await audited(this.prisma, ctx, (tx, audit) => run(tx, audit, ctx.staffId))
  }

  reply(code: number, input: z.output<typeof AdminSupportReply>, ctx: RequestContext) {
    return this.write(ctx, (tx, audit, staffId) => staffReply(tx, this.mail, audit, code, staffId, input))
  }

  claim(code: number, ctx: RequestContext) {
    return this.write(ctx, (tx, audit, staffId) => claimSupportRequest(tx, audit, code, staffId))
  }

  /** Owner only: assigns to a staff member, or unassigns with `null`. */
  assign(code: number, assigneeId: string | null, ctx: RequestContext) {
    return this.write(ctx, (tx, audit) => assignSupportRequest(tx, audit, code, assigneeId))
  }

  /** Attaches an image to the staff member's own message; the stored file is deleted if recording fails. */
  async attach(
    code: number,
    messageId: string,
    file: Express.Multer.File | undefined,
    ctx: RequestContext,
    log: Logger,
  ) {
    const found = await this.repo.findIdByCode(this.prisma, code)
    if (!found) throw notFound()
    const image = await storeSupportImage(this.storage, file, found.id)
    try {
      await audited(this.prisma, ctx, async (tx, audit) => {
        const requestId = await recordAttachment(
          tx,
          { code },
          messageId,
          { type: 'staff', staffId: ctx.staffId },
          image,
        )
        await audit({
          action: 'support.attach',
          entityType: 'support_request',
          entityId: requestId,
          after: { code, messageId, key: image.key, sizeBytes: image.sizeBytes },
        })
      })
    } catch (err) {
      await deleteSupportImageQuietly(this.storage, log, image.key)
      throw err
    }
  }

  // ===== Returns, exchanges, warranty =====

  decide(code: number, input: DecideSupportRequest, ctx: RequestContext) {
    return this.write(ctx, (tx, audit, staffId) => decideSupportRequest(tx, this.mail, audit, code, staffId, input))
  }

  receive(code: number, input: ReceiveSupportReturn, ctx: RequestContext) {
    return this.write(ctx, (tx, audit, staffId) => receiveSupportReturn(tx, audit, code, staffId, input))
  }

  /** The warehouse hands over the new variant after receiving the old one (ADR 0015). */
  shipExchange(code: number, input: ShipExchangeRequest, ctx: RequestContext) {
    return this.write(ctx, (tx, audit, staffId) => shipExchange(tx, this.mail, audit, code, staffId, input))
  }

  /** No milestone touches stock. */
  warrantyMilestone(code: number, input: RecordWarrantyMilestone, ctx: RequestContext) {
    return this.write(ctx, (tx, audit, staffId) => recordWarrantyMilestone(tx, this.mail, audit, code, staffId, input))
  }

  warrantyOutcome(code: number, input: RecordWarrantyOutcome, ctx: RequestContext) {
    return this.write(ctx, (tx, audit, staffId) => recordWarrantyOutcome(tx, this.mail, audit, code, staffId, input))
  }

  refund(code: number, input: ProposeReturnRefund, ctx: RequestContext) {
    return this.write(ctx, (tx, audit, staffId) => proposeReturnRefund(tx, this.mail, audit, code, staffId, input))
  }
}
