import {
  ErrorCode,
  type OrderKind,
  type VoucherConflict,
  type VoucherQuote,
  type VoucherReason,
} from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import type { Voucher } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { computeDiscount, type DiscountLine, type DiscountRule } from './discount.ts'
import { customerRedemptions, usedRedemptions, voucherStatus } from './vouchers.ts'

/** Một dòng của đơn định đặt: biến thể, thương hiệu và danh mục theo snapshot đang xuất bản, giá và số lượng. */
export type VoucherLine = { variantId: string; brandId: string; categoryId: string; price: number; quantity: number }

export type VoucherCheck =
  | { ok: true; voucher: Voucher; discount: bigint; lines: { variantId: string; discount: bigint }[] }
  | { ok: false; code: string; reason: VoucherReason; shortfall?: bigint }

/** Mã khách gõ ở dạng lưu trong DB: bỏ khoảng trắng hai đầu, chữ hoa. */
export const normalizeCode = (code: string) => code.trim().toUpperCase()

/** Danh mục và mọi tổ tiên của nó; cây danh mục nhỏ nên đọc cả bảng một lần. */
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
 * Kiểm một mã cho một đơn định đặt và tính tiền giảm (GLOSSARY "Mã giảm giá", "Lượt dùng"); dùng chung cho báo giá và
 * tạo đơn. Thứ tự kiểm: tồn tại, tắt, chưa tới hạn, hết hạn, hình thức bán, tổng lượt, lượt mỗi khách (chỉ khi có email
 * hoặc số điện thoại), rồi tới tiền hàng và phạm vi.
 *
 * `lock` dùng trong transaction tạo đơn: khóa dòng mã `FOR UPDATE` (sau khi đã khóa biến thể), nên hai khách không cùng
 * lấy được lượt cuối, và nhân viên sửa mã (cũng khóa dòng này) không chen vào giữa lúc kiểm và lúc tạo đơn.
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

/** Kết quả kiểm mã như báo giá trả cho khách. */
export function toVoucherQuote(check: VoucherCheck): VoucherQuote {
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

/**
 * Lúc tạo đơn: trả kết quả khi mã áp được với đúng tiền giảm khách đã thấy; ngược lại ném 409 kèm `details` do
 * `detailsOf` dựng từ `VoucherConflict` (lý do, tiền giảm mới, tổng khi không dùng mã). Không có gì được ghi.
 */
export function requireVoucherAsSeen(
  check: VoucherCheck,
  seenDiscount: number,
  totalWithoutVoucher: number,
  detailsOf: (voucher: VoucherConflict) => Record<string, unknown>,
): Extract<VoucherCheck, { ok: true }> {
  if (check.ok && Number(check.discount) === seenDiscount) return check
  const voucher: VoucherConflict = {
    code: check.ok ? check.voucher.code : check.code,
    reason: check.ok ? 'changed' : check.reason,
    discount: check.ok ? Number(check.discount) : null,
    ...(!check.ok && check.shortfall !== undefined && { shortfall: Number(check.shortfall) }),
    totalWithoutVoucher,
  }
  throw new AppError(
    409,
    ErrorCode.CONFLICT,
    check.ok
      ? 'Tiền giảm của mã đã thay đổi, hãy xem lại trước khi đặt'
      : 'Mã giảm giá không còn dùng được cho đơn này',
    undefined,
    detailsOf(voucher),
  )
}

/** Các cột chụp mã vào đơn (check `order_voucher_check`). */
export const voucherSnapshot = (voucher: Voucher, discount: bigint) => ({
  voucherId: voucher.id,
  voucherCode: voucher.code,
  voucherKind: voucher.kind,
  voucherAmount: voucher.amount,
  voucherPercent: voucher.percent,
  voucherMaxDiscount: voucher.maxDiscount,
  discount,
})
