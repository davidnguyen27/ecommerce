import { Router } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  VOUCHER_FIELDS_EDITABLE_AFTER_USE,
  VoucherCreate,
  VoucherDraft,
  VoucherQuery,
  VoucherUpdate,
  type FieldError,
  type Voucher,
  type VoucherPage,
} from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import type { Db, DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, conflictField, isUniqueViolation } from '../http/errors.ts'
import { pageWindow } from '../http/pagination.ts'
import { parse } from '../http/validation.ts'
import { loadVoucher, toVoucher, usedRedemptions, VOUCHER_INCLUDE, voucherStatusWhere } from '../vouchers/vouchers.ts'

const VoucherParams = z.object({ id: z.uuid() })

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy mã giảm giá')
const codeTaken = () => conflictField('code', 'Mã này đã tồn tại')

/** Thương hiệu và danh mục của phạm vi phải tồn tại; lỗi theo từng phần tử để form chỉ đúng chỗ. */
async function checkScope(db: DbClient, scope: { brandIds?: string[]; categoryIds?: string[] }) {
  const fields: FieldError[] = []
  if (scope.brandIds?.length) {
    const found = new Set((await db.brand.findMany({ where: { id: { in: scope.brandIds } } })).map((b) => b.id))
    scope.brandIds.forEach((id, i) => {
      if (!found.has(id)) fields.push({ path: `brandIds.${i}`, message: 'Không tìm thấy thương hiệu' })
    })
  }
  if (scope.categoryIds?.length) {
    const found = new Set((await db.category.findMany({ where: { id: { in: scope.categoryIds } } })).map((c) => c.id))
    scope.categoryIds.forEach((id, i) => {
      if (!found.has(id)) fields.push({ path: `categoryIds.${i}`, message: 'Không tìm thấy danh mục' })
    })
  }
  if (fields.length) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Phạm vi có mục không hợp lệ', fields)
}

const sorted = (ids: readonly string[]) => [...new Set(ids)].sort()

/** Các trường sửa được của mã, ở dạng so sánh được: thời điểm ISO, danh sách đã sắp xếp. */
type Draft = z.infer<typeof VoucherDraft>

function draftOf(row: Prisma.VoucherGetPayload<{ include: typeof VOUCHER_INCLUDE }>): Draft {
  return {
    description: row.description,
    kind: row.kind,
    amount: row.amount === null ? null : Number(row.amount),
    percent: row.percent,
    maxDiscount: row.maxDiscount === null ? null : Number(row.maxDiscount),
    minSubtotal: Number(row.minSubtotal),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    saleTypes: [...row.saleTypes].sort(),
    totalLimit: row.totalLimit,
    perCustomerLimit: row.perCustomerLimit,
    brandIds: sorted(row.brands.map((b) => b.brandId)),
    categoryIds: sorted(row.categories.map((c) => c.categoryId)),
  }
}

function normalize(input: VoucherUpdate): Partial<Draft> {
  return {
    ...input,
    ...(input.startsAt !== undefined && { startsAt: new Date(input.startsAt).toISOString() }),
    ...(input.endsAt !== undefined && { endsAt: new Date(input.endsAt).toISOString() }),
    ...(input.saleTypes !== undefined && { saleTypes: [...input.saleTypes].sort() }),
    ...(input.brandIds !== undefined && { brandIds: sorted(input.brandIds) }),
    ...(input.categoryIds !== undefined && { categoryIds: sorted(input.categoryIds) }),
  }
}

const columns = (draft: Partial<Draft>) => ({
  ...(draft.description !== undefined && { description: draft.description }),
  ...(draft.kind !== undefined && { kind: draft.kind }),
  ...(draft.amount !== undefined && { amount: draft.amount === null ? null : BigInt(draft.amount) }),
  ...(draft.percent !== undefined && { percent: draft.percent }),
  ...(draft.maxDiscount !== undefined && {
    maxDiscount: draft.maxDiscount === null ? null : BigInt(draft.maxDiscount),
  }),
  ...(draft.minSubtotal !== undefined && { minSubtotal: BigInt(draft.minSubtotal) }),
  ...(draft.startsAt !== undefined && { startsAt: new Date(draft.startsAt) }),
  ...(draft.endsAt !== undefined && { endsAt: new Date(draft.endsAt) }),
  ...(draft.saleTypes !== undefined && { saleTypes: draft.saleTypes }),
  ...(draft.totalLimit !== undefined && { totalLimit: draft.totalLimit }),
  ...(draft.perCustomerLimit !== undefined && { perCustomerLimit: draft.perCustomerLimit }),
})

/**
 * Mã giảm giá, mount tại `/vouchers`. Xem cần `voucher.manage` hoặc `order.view`; tạo, sửa, tắt cần `voucher.manage`.
 * Không có endpoint xóa: mã đã phát ra là lời hứa với khách, chỉ tắt được.
 */
export function adminVoucherRoutes(prisma: Db) {
  return Router()
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
    .post('/', requirePermission('voucher.manage'), async (req, res) => {
      const input = parse(VoucherCreate, req.body)
      const brandIds = sorted(input.brandIds)
      const categoryIds = sorted(input.categoryIds)
      const id = await audited(prisma, req, async (tx, audit) => {
        await checkScope(tx, { brandIds, categoryIds })
        const voucher = await tx.voucher
          .create({
            data: {
              code: input.code,
              ...columns(normalize(input)),
              // Trường bắt buộc, nhắc lại để Prisma thấy kiểu không thiếu.
              kind: input.kind,
              startsAt: new Date(input.startsAt),
              endsAt: new Date(input.endsAt),
              createdById: currentStaff(req).id,
              brands: { create: brandIds.map((brandId) => ({ brandId })) },
              categories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
            },
          })
          .catch((err: unknown) => {
            throw isUniqueViolation(err) ? codeTaken() : err
          })
        await audit({
          action: 'voucher.create',
          entityType: 'voucher',
          entityId: voucher.id,
          after: { ...input, ...normalize(input) },
        })
        return voucher.id
      })
      const body: Voucher = await loadVoucher(prisma, id)
      res.status(201).json(body)
    })
    .patch('/:id', requirePermission('voucher.manage'), async (req, res) => {
      const { id } = parse(VoucherParams, req.params)
      const input = normalize(parse(VoucherUpdate, req.body))

      await audited(prisma, req, async (tx, audit) => {
        // Khóa mã: tạo đơn (ticket 03) cũng khóa dòng này, nên số lượt đã dùng không đổi giữa lúc kiểm và lúc ghi.
        const [locked] = await tx.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "voucher" WHERE "id" = ${id}::uuid FOR UPDATE`
        if (!locked) throw notFound()
        const row = await tx.voucher.findUniqueOrThrow({ where: { id }, include: VOUCHER_INCLUDE })
        const current = draftOf(row)

        const before: Partial<Draft> = {}
        const after: Partial<Draft> = {}
        for (const key of Object.keys(input) as (keyof Draft)[]) {
          if (input[key] === undefined || JSON.stringify(input[key]) === JSON.stringify(current[key])) continue
          Object.assign(before, { [key]: current[key] })
          Object.assign(after, { [key]: input[key] })
        }
        // Không đổi gì thì không ghi gì, kể cả audit.
        if (Object.keys(after).length === 0) return

        if (row.disabledAt) throw new AppError(409, ErrorCode.CONFLICT, 'Mã đã tắt, không sửa được')
        const used = (await usedRedemptions(tx, [id])).get(id) ?? 0
        if (used > 0) {
          const editable: readonly string[] = VOUCHER_FIELDS_EDITABLE_AFTER_USE
          const locked = Object.keys(after).filter((key) => !editable.includes(key))
          if (locked.length) {
            throw new AppError(
              409,
              ErrorCode.CONFLICT,
              'Mã đã có lượt dùng: chỉ đổi được mô tả, thời điểm kết thúc và tổng lượt',
              locked.map((path) => ({ path, message: 'Mã đã có lượt dùng, không đổi được' })),
            )
          }
        }
        if (after.totalLimit != null && after.totalLimit < used) {
          throw conflictField('totalLimit', `Đã dùng ${used} lượt, tổng lượt không thấp hơn được`)
        }
        // Kiểm lại ràng buộc giữa các trường trên bản đã ghép, ví dụ đổi sang `percent` thì phải có mức tối đa.
        parse(VoucherDraft, { ...current, ...after })
        await checkScope(tx, { brandIds: after.brandIds, categoryIds: after.categoryIds })

        await tx.voucher.update({ where: { id }, data: columns(after) })
        if (after.brandIds) {
          await tx.voucherBrand.deleteMany({ where: { voucherId: id } })
          await tx.voucherBrand.createMany({ data: after.brandIds.map((brandId) => ({ voucherId: id, brandId })) })
        }
        if (after.categoryIds) {
          await tx.voucherCategory.deleteMany({ where: { voucherId: id } })
          await tx.voucherCategory.createMany({
            data: after.categoryIds.map((categoryId) => ({ voucherId: id, categoryId })),
          })
        }
        await audit({ action: 'voucher.update', entityType: 'voucher', entityId: id, before, after })
      })
      const body: Voucher = await loadVoucher(prisma, id)
      res.json(body)
    })
    .post('/:id/disable', requirePermission('voucher.manage'), async (req, res) => {
      const { id } = parse(VoucherParams, req.params)
      await audited(prisma, req, async (tx, audit) => {
        const [voucher] = await tx.$queryRaw<{ disabledAt: Date | null }[]>`
          SELECT "disabled_at" AS "disabledAt" FROM "voucher" WHERE "id" = ${id}::uuid FOR UPDATE`
        if (!voucher) throw notFound()
        // Đã tắt thì không làm gì; không bật lại được.
        if (voucher.disabledAt) return
        const disabledAt = new Date()
        await tx.voucher.update({ where: { id }, data: { disabledAt } })
        await audit({
          action: 'voucher.disable',
          entityType: 'voucher',
          entityId: id,
          after: { disabledAt: disabledAt.toISOString() },
        })
      })
      const body: Voucher = await loadVoucher(prisma, id)
      res.json(body)
    })
}
