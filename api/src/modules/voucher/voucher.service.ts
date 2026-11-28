import type { Voucher, VoucherOrderPage, VoucherPage } from '@ecommerce/shared'
import type { z } from 'zod'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type { VoucherCreateDto, VoucherOrdersQueryDto, VoucherQueryDto, VoucherUpdateDto } from './dto/index.ts'
import { createVoucher, disableVoucher, updateVoucher } from './voucher.admin.ts'
import { toVoucher, toVoucherOrder } from './voucher.mapper.ts'
import { usedRedemptions, voucherNotFound, voucherStatusWhere } from './voucher.query.ts'
import type { VoucherRepository } from './voucher.repository.ts'

/**
 * Admin vouchers (GLOSSARY "Mã giảm giá"). No delete: an issued voucher is a promise to customers and can only be
 * disabled. Each write runs under the voucher's row lock in one audited transaction, then returns the reloaded voucher.
 */
export class VoucherService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: VoucherRepository,
  ) {}

  async list(query: z.output<typeof VoucherQueryDto>): Promise<VoucherPage> {
    const now = new Date()
    const where: Prisma.VoucherWhereInput = {
      ...(query.status !== 'all' ? voucherStatusWhere(query.status, now) : {}),
      ...(query.q ? { code: { contains: query.q.toUpperCase() } } : {}),
    }
    const { rows, total } = await this.repo.page(this.prisma, where, query)
    const used = await usedRedemptions(
      this.prisma,
      rows.map((r) => r.id),
    )
    return {
      items: rows.map((row) => toVoucher(row, used.get(row.id) ?? 0, now)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    }
  }

  async get(id: string): Promise<Voucher> {
    const row = await this.repo.findWithScope(this.prisma, id)
    if (!row) throw voucherNotFound()
    return toVoucher(row, (await usedRedemptions(this.prisma, [id])).get(id) ?? 0)
  }

  /** Orders that used the voucher, cancelled ones too (they take no use). */
  async orders(id: string, query: z.output<typeof VoucherOrdersQueryDto>): Promise<VoucherOrderPage> {
    if (!(await this.repo.exists(this.prisma, id))) throw voucherNotFound()
    const { orders, total } = await this.repo.orders(this.prisma, id, query)
    return { items: orders.map(toVoucherOrder), total, page: query.page, pageSize: query.pageSize }
  }

  async create(input: z.output<typeof VoucherCreateDto>, ctx: RequestContext) {
    const id = await audited(this.prisma, ctx, (tx, audit) => createVoucher(tx, audit, ctx.staffId, input))
    return this.get(id)
  }

  async update(id: string, input: z.output<typeof VoucherUpdateDto>, ctx: RequestContext) {
    await audited(this.prisma, ctx, (tx, audit) => updateVoucher(tx, audit, id, input))
    return this.get(id)
  }

  async disable(id: string, ctx: RequestContext) {
    await audited(this.prisma, ctx, (tx, audit) => disableVoucher(tx, audit, id))
    return this.get(id)
  }
}
