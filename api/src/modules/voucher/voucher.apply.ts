import {
  ErrorCode,
  type OrderKind,
  type VoucherConflict,
  type VoucherQuote,
  type VoucherReason,
} from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import type { Voucher } from '../../generated/prisma/client.ts'
import { AppError } from '../../core/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../../core/middleware/rate-limit.ts'
import { computeDiscount, type DiscountLine, type DiscountRule } from './voucher.discount.ts'
import { customerRedemptions, usedRedemptions, voucherStatus } from './voucher.query.ts'

/** A line of the order being placed: variant, brand and category from the live snapshot, price, quantity. */
export type VoucherLine = { variantId: string; brandId: string; categoryId: string; price: number; quantity: number }

export type VoucherCheck =
  | { ok: true; voucher: Voucher; discount: bigint; lines: { variantId: string; discount: bigint }[] }
  | { ok: false; code: string; reason: VoucherReason; shortfall?: bigint }

/** The typed code as stored: trimmed, uppercase. */
export const normalizeCode = (code: string) => code.trim().toUpperCase()

/** A category and all its ancestors; the tree is small, so read it whole. */
async function categoryPaths(db: DbClient, categoryIds: readonly string[]) {
  const all = await db.category.findMany({ select: { id: true, parentId: true } })
  const parent = new Map(all.map((c) => [c.id, c.parentId]))
  return new Map(
    categoryIds.map((id) => {
      const path: string[] = []
      for (let at: string | null | undefined = id; at && !path.includes(at); at = parent.get(at)) path.push(at)
      return [id, path]
    }),
  )
}

/**
 * Checks a voucher for an order and computes the discount (GLOSSARY "Mã giảm giá", "Lượt dùng"); shared by quote and
 * placement. Order: exists, disabled, not started, expired, sale type, total uses, per-customer uses (with email or
 * phone), then goods and scope.
 * `lock` (placement only) locks the voucher row after the variants, so two customers cannot take the last use and a
 * staff edit cannot slip in between check and order.
 */
export async function checkVoucher(
  db: DbClient,
  rawCode: string,
  {
    saleType,
    lines,
    customer,
    lock = false,
    now = new Date(),
  }: {
    saleType: OrderKind
    lines: readonly VoucherLine[]
    customer: { email?: string | null; phone?: string | null }
    lock?: boolean
    now?: Date
  },
): Promise<VoucherCheck> {
  const code = normalizeCode(rawCode)
  const fail = (reason: VoucherReason, shortfall?: bigint): VoucherCheck => ({ ok: false, code, reason, shortfall })

  if (lock) await db.$queryRaw`SELECT 1 FROM "voucher" WHERE "code" = ${code} FOR UPDATE`
  const voucher = await db.voucher.findUnique({
    where: { code },
    include: { brands: { select: { brandId: true } }, categories: { select: { categoryId: true } } },
  })
  if (!voucher) return fail('not_found')
  const status = voucherStatus(voucher, now)
  if (status === 'disabled') return fail('disabled')
  if (status === 'upcoming') return fail('not_started')
  if (status === 'expired') return fail('expired')
  if (!voucher.saleTypes.includes(saleType)) return fail('sale_type')
  if (voucher.totalLimit !== null) {
    const used = (await usedRedemptions(db, [voucher.id])).get(voucher.id) ?? 0
    if (used >= voucher.totalLimit) return fail('exhausted')
  }
  if ((await customerRedemptions(db, voucher.id, customer)) >= voucher.perCustomerLimit) return fail('customer_limit')

  const paths = await categoryPaths(db, [...new Set(lines.map((l) => l.categoryId))])
  const discountLines: DiscountLine[] = lines.map((line) => ({
    variantId: line.variantId,
    brandId: line.brandId,
    categoryPath: paths.get(line.categoryId) ?? [line.categoryId],
    price: BigInt(line.price),
    quantity: line.quantity,
  }))
  const scope = {
    minSubtotal: voucher.minSubtotal,
    brandIds: voucher.brands.map((b) => b.brandId),
    categoryIds: voucher.categories.map((c) => c.categoryId),
  }
  const rule: DiscountRule =
    voucher.kind === 'fixed'
      ? { kind: 'fixed', amount: voucher.amount!, ...scope }
      : { kind: 'percent', percent: voucher.percent!, maxDiscount: voucher.maxDiscount!, ...scope }
  const result = computeDiscount(discountLines, rule)
  if (!result.ok) return fail(result.reason, result.reason === 'below_minimum' ? result.shortfall : undefined)
  const { brands: _brands, categories: _categories, ...row } = voucher
  return { ok: true, voucher: row, discount: result.discount, lines: result.lines }
}

type VoucherInput = {
  saleType: OrderKind
  lines: readonly VoucherLine[]
  customer: { email?: string | null; phone?: string | null }
}

/**
 * Quote with a voucher: counts one hit against the guessing limit of the caller's IP, then checks. Writes only the
 * counter.
 */
export async function quoteVoucher(
  db: DbClient,
  clientIp: string,
  code: string,
  input: VoucherInput,
): Promise<VoucherQuote> {
  await enforceRateLimits(
    db,
    [{ limit: RATE_LIMITS.voucherCheckPerIp, subject: clientIp }],
    'Bạn đã thử mã giảm giá quá nhiều lần, vui lòng thử lại sau',
  )
  return toVoucherQuote(await checkVoucher(db, code, input))
}

/**
 * At placement: locks the voucher row and rechecks; returns when it applies with exactly the discount seen. Otherwise
 * throws 409 with `details` from `detailsOf(VoucherConflict)`. Call after locking variants (and allocation rows).
 */
export async function applyVoucherToOrder(
  tx: DbClient,
  code: string,
  input: VoucherInput & {
    seenDiscount: number
    withoutVoucher: Pick<VoucherConflict, 'totalWithoutVoucher' | 'depositAmountWithoutVoucher'>
    detailsOf: (voucher: VoucherConflict) => Record<string, unknown>
  },
): Promise<Extract<VoucherCheck, { ok: true }>> {
  const check = await checkVoucher(tx, code, { ...input, lock: true })
  if (check.ok && Number(check.discount) === input.seenDiscount) return check
  const voucher: VoucherConflict = {
    code: check.ok ? check.voucher.code : check.code,
    reason: check.ok ? 'changed' : check.reason,
    discount: check.ok ? Number(check.discount) : null,
    ...(!check.ok && check.shortfall !== undefined && { shortfall: Number(check.shortfall) }),
    ...input.withoutVoucher,
  }
  throw new AppError(
    409,
    ErrorCode.CONFLICT,
    check.ok
      ? 'Tiền giảm của mã đã thay đổi, hãy xem lại trước khi đặt'
      : 'Mã giảm giá không còn dùng được cho đơn này',
    undefined,
    input.detailsOf(voucher),
  )
}

/** Check result as the quote returns it. */
function toVoucherQuote(check: VoucherCheck): VoucherQuote {
  return check.ok
    ? {
        applied: true,
        code: check.voucher.code,
        discount: Number(check.discount),
        lines: check.lines.map((l) => ({ variantId: l.variantId, discount: Number(l.discount) })),
      }
    : {
        applied: false,
        code: check.code,
        reason: check.reason,
        ...(check.shortfall !== undefined && { shortfall: Number(check.shortfall) }),
      }
}

/** Voucher snapshot columns on the order (`order_voucher_check`). */
export const voucherSnapshot = (voucher: Voucher, discount: bigint) => ({
  voucherId: voucher.id,
  voucherCode: voucher.code,
  voucherKind: voucher.kind,
  voucherAmount: voucher.amount,
  voucherPercent: voucher.percent,
  voucherMaxDiscount: voucher.maxDiscount,
  discount,
})
