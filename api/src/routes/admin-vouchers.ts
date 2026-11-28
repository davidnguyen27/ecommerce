import { Router } from 'express'
import { z } from 'zod'
import {
  VoucherCreate,
  VoucherQuery,
  VoucherUpdate,
  PageQuery,
  type Voucher,
  type VoucherOrderPage,
  type VoucherPage,
} from '@ecommerce/shared'
import { audited } from '../core/audit/audited.ts'
import { currentStaff, requirePermission } from '../core/middleware/staff-context.ts'
import type { Db } from '../core/db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { pageWindow } from '../core/pagination.ts'
import { parse } from '../core/middleware/validation.ts'
import { createVoucher, disableVoucher, updateVoucher } from '../vouchers/voucher-admin.ts'
import {
  loadVoucher,
  toVoucher,
  usedRedemptions,
  VOUCHER_INCLUDE,
  voucherNotFound as notFound,
  voucherStatusWhere,
} from '../vouchers/vouchers.ts'

const VoucherParams = z.object({ id: z.uuid() })

/**
 * Vouchers, mounted at `/vouchers`. Viewing needs `voucher.manage` or `order.view`; create, edit, disable need
 * `voucher.manage`. No delete: an issued voucher is a promise to customers and can only be disabled.
 */
export function adminVoucherRoutes(prisma: Db) {
  return (
    Router()
      .use(requirePermission('order.view', 'voucher.manage'))
      .get('/', async (req, res) => {
        const query = parse(VoucherQuery, req.query)
        const now = new Date()
        const where: Prisma.VoucherWhereInput = {
          ...(query.status !== 'all' ? voucherStatusWhere(query.status, now) : {}),
          ...(query.q ? { code: { contains: query.q.toUpperCase() } } : {}),
        }
        const [rows, total] = await Promise.all([
          prisma.voucher.findMany({
            where,
            include: VOUCHER_INCLUDE,
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            ...pageWindow(query),
          }),
          prisma.voucher.count({ where }),
        ])
        const used = await usedRedemptions(
          prisma,
          rows.map((r) => r.id),
        )
        const body: VoucherPage = {
          items: rows.map((row) => toVoucher(row, used.get(row.id) ?? 0, now)),
          total,
          page: query.page,
          pageSize: query.pageSize,
        }
        res.json(body)
      })
      .get('/:id', async (req, res) => {
        const { id } = parse(VoucherParams, req.params)
        const body: Voucher = await loadVoucher(prisma, id)
        res.json(body)
      })
      // Orders that used the voucher, cancelled ones too (they take no use); newest first (ticket 06).
      .get('/:id/orders', async (req, res) => {
        const { id } = parse(VoucherParams, req.params)
        const query = parse(PageQuery, req.query)
        if (!(await prisma.voucher.findUnique({ where: { id }, select: { id: true } }))) throw notFound()
        const where = { voucherId: id }
        const [orders, total] = await Promise.all([
          prisma.order.findMany({ where, orderBy: [{ createdAt: 'desc' }, { code: 'desc' }], ...pageWindow(query) }),
          prisma.order.count({ where }),
        ])
        const body: VoucherOrderPage = {
          items: orders.map((o) => ({
            code: o.code,
            kind: o.kind,
            recipientName: o.recipientName,
            email: o.email,
            status: o.status,
            paymentStatus: o.paymentStatus,
            discount: Number(o.discount),
            total: Number(o.total),
            createdAt: o.createdAt.toISOString(),
            counted: o.status !== 'cancelled',
          })),
          total,
          page: query.page,
          pageSize: query.pageSize,
        }
        res.json(body)
      })
      .post('/', requirePermission('voucher.manage'), async (req, res) => {
        const input = parse(VoucherCreate, req.body)
        const id = await audited(prisma, req, (tx, audit) => createVoucher(tx, audit, currentStaff(req).id, input))
        const body: Voucher = await loadVoucher(prisma, id)
        res.status(201).json(body)
      })
      .patch('/:id', requirePermission('voucher.manage'), async (req, res) => {
        const { id } = parse(VoucherParams, req.params)
        const input = parse(VoucherUpdate, req.body)
        await audited(prisma, req, (tx, audit) => updateVoucher(tx, audit, id, input))
        const body: Voucher = await loadVoucher(prisma, id)
        res.json(body)
      })
      .post('/:id/disable', requirePermission('voucher.manage'), async (req, res) => {
        const { id } = parse(VoucherParams, req.params)
        await audited(prisma, req, (tx, audit) => disableVoucher(tx, audit, id))
        const body: Voucher = await loadVoucher(prisma, id)
        res.json(body)
      })
  )
}
