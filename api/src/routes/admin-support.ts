import { Router } from 'express'
import {
  AdminCreateSupportRequest,
  AdminSupportQuery,
  AdminSupportReply,
  AssignSupportRequest,
  ErrorCode,
  SUPPORT_CLOSED_STATUSES,
  type AdminSupportPage,
  type AdminSupportRequest,
} from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { pageWindow } from '../http/pagination.ts'
import { parse } from '../http/validation.ts'
import type { CustomerMail } from '../jobs/jobs.ts'
import {
  SUPPORT_INCLUDE,
  assignSupportRequest,
  claimSupportRequest,
  createSupportRequest,
  staffReply,
  toAdminSupport,
  toAdminSupportSummary,
} from '../support/support.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy yêu cầu')
const requestCode = (code: string) => {
  if (!/^\d{1,9}$/.test(code)) throw notFound()
  return Number(code)
}

/**
 * Yêu cầu hỗ trợ ở trang quản trị (spec M6b), mount tại `/support-requests`. Xem cần `support.handle` hoặc
 * `order.view`; trả lời, ghi chú, đổi trạng thái, nhận việc, tạo hộ cần `support.handle`; giao cho người khác chỉ owner
 * (`staff.manage`). Mọi thao tác ghi đi qua `audited()` và trả lại chi tiết yêu cầu.
 */
export function adminSupportRoutes(prisma: Db, mail: CustomerMail) {
  const load = async (code: number) => {
    const request = await prisma.supportRequest.findUnique({ where: { code }, include: SUPPORT_INCLUDE })
    if (!request) throw notFound()
    const body: AdminSupportRequest = toAdminSupport(request)
    return body
  }
  return Router()
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
      }
      const [requests, total] = await Promise.all([
        prisma.supportRequest.findMany({
          where,
          include: SUPPORT_INCLUDE,
          // Việc cũ trước: khách chờ lâu nhất được xử lý trước.
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
    .get('/:code', async (req, res) => {
      res.json(await load(requestCode(String(req.params.code))))
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
        const customer = order
          ? undefined
          : await tx.customer.findUnique({ where: { email: input.customerEmail! }, select: { id: true, email: true } })
        if (!order && !customer) throw invalidField('customerEmail', 'Không có tài khoản khách với email này')
        const request = await createSupportRequest(tx, mail, {
          kind: input.kind,
          subject: input.subject,
          message: input.message,
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
      res.status(201).json(await load(code))
    })
    .post('/:code/reply', requirePermission('support.handle'), async (req, res) => {
      const input = parse(AdminSupportReply, req.body)
      const code = requestCode(String(req.params.code))
      const staffId = currentStaff(req).id
      await audited(prisma, req, (tx, audit) => staffReply(tx, mail, audit, code, staffId, input))
      res.json(await load(code))
    })
    .post('/:code/claim', requirePermission('support.handle'), async (req, res) => {
      const code = requestCode(String(req.params.code))
      const staffId = currentStaff(req).id
      await audited(prisma, req, (tx, audit) => claimSupportRequest(tx, audit, code, staffId))
      res.json(await load(code))
    })
    .post('/:code/assign', requirePermission('staff.manage'), async (req, res) => {
      const { staffId } = parse(AssignSupportRequest, req.body)
      const code = requestCode(String(req.params.code))
      await audited(prisma, req, (tx, audit) => assignSupportRequest(tx, audit, code, staffId))
      res.json(await load(code))
    })
}
