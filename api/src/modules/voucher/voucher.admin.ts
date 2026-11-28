import { z } from 'zod'
import {
  ErrorCode,
  VOUCHER_FIELDS_EDITABLE_AFTER_USE,
  VoucherCreate,
  VoucherDraft,
  VoucherUpdate,
  type FieldError,
} from '@ecommerce/shared'
import type { Audit } from '../../core/audit/audited.ts'
import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { AppError, conflictField, isUniqueViolation } from '../../core/errors.ts'
import { parse } from '../../core/middleware/validation.ts'
import { VOUCHER_INCLUDE, toVoucher } from './voucher.mapper.ts'
import { usedRedemptions, voucherNotFound as notFound } from './voucher.query.ts'

// Admin voucher writes (GLOSSARY "Mã giảm giá"), run inside `audited()`. The route reloads the voucher with
// `loadVoucher` for the response.

type Tx = Prisma.TransactionClient

const codeTaken = () => conflictField('code', 'Mã này đã tồn tại')

/** Scope brands and categories must exist; errors per element so the form points at the right spot. */
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

/** A voucher's editable fields in comparable form: ISO timestamps, sorted lists. */
type Draft = z.infer<typeof VoucherDraft>

/** The editable part of a voucher, taken from the response shape (`toVoucher`) so both sides convert the same way. */
function draftOf(row: Prisma.VoucherGetPayload<{ include: typeof VOUCHER_INCLUDE }>): Draft {
  const { brands, categories, ...v } = toVoucher(row, 0)
  return {
    description: v.description,
    kind: v.kind,
    amount: v.amount,
    percent: v.percent,
    maxDiscount: v.maxDiscount,
    minSubtotal: v.minSubtotal,
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    saleTypes: v.saleTypes,
    totalLimit: v.totalLimit,
    perCustomerLimit: v.perCustomerLimit,
    brandIds: sorted(brands.map((b) => b.id)),
    categoryIds: sorted(categories.map((c) => c.id)),
  }
}

function normalize(input: z.output<typeof VoucherUpdate>): Partial<Draft> {
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

/** Creates a voucher; a taken code is a 409 on `code`. Returns its id. */
export async function createVoucher(
  tx: Tx,
  audit: Audit,
  staffId: string,
  input: z.output<typeof VoucherCreate>,
): Promise<string> {
  const brandIds = sorted(input.brandIds)
  const categoryIds = sorted(input.categoryIds)
  await checkScope(tx, { brandIds, categoryIds })
  const voucher = await tx.voucher
    .create({
      data: {
        code: input.code,
        ...columns(normalize(input)),
        // Required field, restated so Prisma sees the type is complete.
        kind: input.kind,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        createdById: staffId,
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
}

/**
 * Edits a voucher under its row lock (placement locks it too, so uses cannot change between check and write). Only
 * changed fields are written; nothing changed writes nothing, audit included. Disabled vouchers cannot be edited; used
 * ones only in `VOUCHER_FIELDS_EDITABLE_AFTER_USE`, and total uses never below used.
 */
export async function updateVoucher(
  tx: Tx,
  audit: Audit,
  id: string,
  update: z.output<typeof VoucherUpdate>,
): Promise<void> {
  const input = normalize(update)
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
  // Nothing changed: write nothing, audit included.
  if (Object.keys(after).length === 0) return

  if (row.disabledAt) throw new AppError(409, ErrorCode.CONFLICT, 'Mã đã tắt, không sửa được')
  const used = (await usedRedemptions(tx, [id])).get(id) ?? 0
  if (used > 0) {
    const editable: readonly string[] = VOUCHER_FIELDS_EDITABLE_AFTER_USE
    const lockedFields = Object.keys(after).filter((key) => !editable.includes(key))
    if (lockedFields.length) {
      throw new AppError(
        409,
        ErrorCode.CONFLICT,
        'Mã đã có lượt dùng: chỉ đổi được mô tả, thời điểm kết thúc và tổng lượt',
        lockedFields.map((path) => ({ path, message: 'Mã đã có lượt dùng, không đổi được' })),
      )
    }
  }
  if (after.totalLimit != null && after.totalLimit < used) {
    throw conflictField('totalLimit', `Đã dùng ${used} lượt, tổng lượt không thấp hơn được`)
  }
  // Recheck cross-field rules on the merged version, e.g. switching to `percent` requires a max discount.
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
}

/** Disables a voucher under its row lock; already disabled does nothing. It can never be re-enabled. */
export async function disableVoucher(tx: Tx, audit: Audit, id: string): Promise<void> {
  const [voucher] = await tx.$queryRaw<{ disabledAt: Date | null }[]>`
    SELECT "disabled_at" AS "disabledAt" FROM "voucher" WHERE "id" = ${id}::uuid FOR UPDATE`
  if (!voucher) throw notFound()
  if (voucher.disabledAt) return
  const disabledAt = new Date()
  await tx.voucher.update({ where: { id }, data: { disabledAt } })
  await audit({
    action: 'voucher.disable',
    entityType: 'voucher',
    entityId: id,
    before: { disabledAt: null },
    after: { disabledAt: disabledAt.toISOString() },
  })
}
