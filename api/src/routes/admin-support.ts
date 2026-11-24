import { Router, type Request } from 'express'
import { toMessageView } from '../chat/chat.ts'
import {
  AdminCreateSupportRequest,
  AdminSupportQuery,
  AdminSupportReply,
  AssignSupportRequest,
  DecideSupportRequest,
  ProposeReturnRefund,
  ReceiveSupportReturn,
  ShipExchangeRequest,
  RecordWarrantyMilestone,
  RecordWarrantyOutcome,
  ErrorCode,
  SUPPORT_CLOSED_STATUSES,
  type AdminSupportPage,
  type ExchangeOptions,
  type AdminSupportRequest,
} from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { audited } from '../audit/audited.ts'
import { currentStaff, hasPermission, requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { pageWindow } from '../http/pagination.ts'
import { parse } from '../http/validation.ts'
import type { CustomerMail } from '../jobs/jobs.ts'
import { deleteSupportImageQuietly, receiveSupportImage, storeSupportImage } from '../media/support-images.ts'
import {
  SUPPORT_INCLUDE,
  assignSupportRequest,
  claimSupportRequest,
  createSupportRequest,
  findSupportCustomer,
  recordAttachment,
  staffReply,
  toAdminSupport,
  toAdminSupportSummary,
} from '../support/support.ts'
import {
  decideSupportRequest,
  proposeReturnRefund,
  receiveSupportReturn,
  returnRefundHint,
} from '../support/returns.ts'
import { exchangeOptions, shipExchange } from '../support/exchanges.ts'
import { hasWarrantyCommitment, recordWarrantyMilestone, recordWarrantyOutcome } from '../support/warranty.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy yêu cầu')
const requestCode = (code: string) => {
  if (!/^\d{1,9}$/.test(code)) throw notFound()
  return Number(code)
}

/** Chatbot conversation turned into a request (M8); readable through the request only with `support.handle`. */
async function chatTranscript(prisma: Db, requestId: string) {
  const conversation = await prisma.chatConversation.findUnique({
    where: { supportRequestId: requestId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  return conversation ? conversation.messages.map(toMessageView) : null
}

/**
 * Admin support requests (spec M6b), mounted at `/support-requests`. Viewing needs `support.handle` or `order.view`;
 * reply, note, status, take and create-on-behalf need `support.handle`; assigning to others is owner-only
 * (`staff.manage`). Every write goes through `audited()` and returns the request detail.
 */
export function adminSupportRoutes(prisma: Db, storage: Storage, mail: CustomerMail) {
  // The chatbot transcript is the customer talking to the chatbot, like messages with support: only `support.handle`
  // reads it (spec M8). Warehouse and accounting (`order.view`) opening the request do not see it.
  const load = async (code: number, req: Request) => {
    const request = await prisma.supportRequest.findUnique({ where: { code }, include: SUPPORT_INCLUDE })
    if (!request) throw notFound()
    const body: AdminSupportRequest = {
      ...(await toAdminSupport(storage, request)),
      returnRefund: await returnRefundHint(prisma, request),
      hasWarrantyCommitment: await hasWarrantyCommitment(prisma, request),
      chatTranscript: hasPermission(req, 'support.handle') ? await chatTranscript(prisma, request.id) : null,
    }
    return body
  }
  return (
    Router()
      .use(requirePermission('support.handle', 'order.view'))
      .get('/', async (req, res) => {
        const query = parse(AdminSupportQuery, req.query)
        const staffId = currentStaff(req).id
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
        const [requests, total] = await Promise.all([
          prisma.supportRequest.findMany({
            where,
            include: SUPPORT_INCLUDE,
            // Oldest first: the customer waiting longest is served first.
            orderBy: [{ createdAt: 'asc' }, { code: 'asc' }],
            ...pageWindow(query),
          }),
          prisma.supportRequest.count({ where }),
        ])
        const body: AdminSupportPage = {
          items: requests.map(toAdminSupportSummary),
          total,
          page: query.page,
          pageSize: query.pageSize,
        }
        res.json(body)
      })
      // Exchangeable variants per line of one order, for the create-on-behalf exchange page.
      .get('/exchange-options', requirePermission('support.handle'), async (req, res) => {
        const orderCode = typeof req.query.orderCode === 'string' ? Number(req.query.orderCode) : NaN
        const order = Number.isInteger(orderCode)
          ? await prisma.order.findUnique({ where: { code: orderCode }, select: { id: true } })
          : null
        if (!order) throw invalidField('orderCode', 'Không có đơn này')
        const body: ExchangeOptions = await exchangeOptions(prisma, order.id)
        res.json(body)
      })
      .get('/:code', async (req, res) => {
        res.json(await load(requestCode(String(req.params.code)), req))
      })
      .post('/', requirePermission('support.handle'), async (req, res) => {
        const input = parse(AdminCreateSupportRequest, req.body)
        const staffId = currentStaff(req).id
        const code = await audited(prisma, req, async (tx, audit) => {
          const order =
            input.orderCode === undefined
              ? undefined
              : await tx.order.findUnique({
                  where: { code: input.orderCode },
                  select: { id: true, code: true, email: true, recipientName: true, customerId: true },
                })
          if (input.orderCode !== undefined && !order) throw invalidField('orderCode', 'Không có đơn này')
          const customer = order ? undefined : await findSupportCustomer(tx, { email: input.customerEmail! })
          if (!order && !customer) throw invalidField('customerEmail', 'Không có tài khoản khách với email này')
          const request = await createSupportRequest(tx, mail, {
            kind: input.kind,
            subject: input.subject,
            message: input.message,
            lines: 'lines' in input ? input.lines : undefined,
            creator: { type: 'staff', staffId },
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
        res.status(201).json(await load(code, req))
      })
      .post('/:code/reply', requirePermission('support.handle'), async (req, res) => {
        const input = parse(AdminSupportReply, req.body)
        const code = requestCode(String(req.params.code))
        const staffId = currentStaff(req).id
        await audited(prisma, req, (tx, audit) => staffReply(tx, mail, audit, code, staffId, input))
        res.json(await load(code, req))
      })
      .post('/:code/claim', requirePermission('support.handle'), async (req, res) => {
        const code = requestCode(String(req.params.code))
        const staffId = currentStaff(req).id
        await audited(prisma, req, (tx, audit) => claimSupportRequest(tx, audit, code, staffId))
        res.json(await load(code, req))
      })
      // Images attach to the staff member's own message (spec M6b ticket 02).
      .post(
        '/:code/messages/:messageId/attachments',
        requirePermission('support.handle'),
        receiveSupportImage,
        async (req, res) => {
          const code = requestCode(String(req.params.code))
          const found = await prisma.supportRequest.findUnique({ where: { code }, select: { id: true } })
          if (!found) throw notFound()
          const staffId = currentStaff(req).id
          const image = await storeSupportImage(storage, req, found.id)
          try {
            await audited(prisma, req, async (tx, audit) => {
              const requestId = await recordAttachment(
                tx,
                { code },
                String(req.params.messageId),
                { type: 'staff', staffId },
                image,
              )
              await audit({
                action: 'support.attach',
                entityType: 'support_request',
                entityId: requestId,
                after: { code, messageId: String(req.params.messageId), key: image.key, sizeBytes: image.sizeBytes },
              })
            })
          } catch (err) {
            await deleteSupportImageQuietly(storage, req, image.key)
            throw err
          }
          res.status(201).json(await load(code, req))
        },
      )
      // Returns (ticket 04): accept/reject, warehouse receiving, refund proposal.
      .post('/:code/decide', requirePermission('support.handle'), async (req, res) => {
        const input = parse(DecideSupportRequest, req.body)
        const code = requestCode(String(req.params.code))
        const staffId = currentStaff(req).id
        await audited(prisma, req, (tx, audit) => decideSupportRequest(tx, mail, audit, code, staffId, input))
        res.json(await load(code, req))
      })
      .post('/:code/receive', requirePermission('order.fulfill'), async (req, res) => {
        const input = parse(ReceiveSupportReturn, req.body)
        const code = requestCode(String(req.params.code))
        const staffId = currentStaff(req).id
        await audited(prisma, req, (tx, audit) => receiveSupportReturn(tx, audit, code, staffId, input))
        res.json(await load(code, req))
      })
      // Exchanges: the warehouse hands over the new variant after receiving the old one (ADR 0015).
      .post('/:code/exchange-ship', requirePermission('order.fulfill'), async (req, res) => {
        const input = parse(ShipExchangeRequest, req.body)
        const code = requestCode(String(req.params.code))
        const staffId = currentStaff(req).id
        await audited(prisma, req, (tx, audit) => shipExchange(tx, mail, audit, code, staffId, input))
        res.json(await load(code, req))
      })
      // Warranty: milestones and outcome (spec M6b ticket 06). No milestone touches stock.
      .post('/:code/warranty-milestone', requirePermission('support.handle'), async (req, res) => {
        const input = parse(RecordWarrantyMilestone, req.body)
        const code = requestCode(String(req.params.code))
        const staffId = currentStaff(req).id
        await audited(prisma, req, (tx, audit) => recordWarrantyMilestone(tx, mail, audit, code, staffId, input))
        res.json(await load(code, req))
      })
      .post('/:code/warranty-outcome', requirePermission('support.handle'), async (req, res) => {
        const input = parse(RecordWarrantyOutcome, req.body)
        const code = requestCode(String(req.params.code))
        const staffId = currentStaff(req).id
        await audited(prisma, req, (tx, audit) => recordWarrantyOutcome(tx, mail, audit, code, staffId, input))
        res.json(await load(code, req))
      })
      .post('/:code/refund', requirePermission('support.handle'), async (req, res) => {
        const input = parse(ProposeReturnRefund, req.body)
        const code = requestCode(String(req.params.code))
        const staffId = currentStaff(req).id
        await audited(prisma, req, (tx, audit) => proposeReturnRefund(tx, mail, audit, code, staffId, input))
        res.json(await load(code, req))
      })
      .post('/:code/assign', requirePermission('staff.manage'), async (req, res) => {
        const { staffId } = parse(AssignSupportRequest, req.body)
        const code = requestCode(String(req.params.code))
        await audited(prisma, req, (tx, audit) => assignSupportRequest(tx, audit, code, staffId))
        res.json(await load(code, req))
      })
  )
}
