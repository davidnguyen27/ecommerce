/** Một dòng đơn như hàm tính giảm cần: phạm vi xét theo thương hiệu và chuỗi danh mục của sản phẩm. */
export type DiscountLine = {
  variantId: string
  brandId: string
  /** Danh mục của sản phẩm cùng mọi tổ tiên của nó, thứ tự không quan trọng. */
  categoryPath: readonly string[]
  /** Giá bán VND. */
  price: bigint
  quantity: number
}

/** Các điều kiện tính tiền của mã; thời hạn, trạng thái và lượt do nơi gọi kiểm. */
export type DiscountRule = (
  { kind: 'fixed'; amount: bigint } | { kind: 'percent'; percent: number; maxDiscount: bigint }
) & {
  minSubtotal: bigint
  /** Trống là không giới hạn theo thương hiệu. */
  brandIds: readonly string[]
  /** Trống là không giới hạn theo danh mục; một danh mục gồm cả con cháu. */
  categoryIds: readonly string[]
}

export type DiscountResult =
  | { ok: true; discount: bigint; lines: { variantId: string; discount: bigint }[] }
  | { ok: false; reason: 'not_applicable' }
  | { ok: false; reason: 'below_minimum'; shortfall: bigint }

const STEP = 1000n
/** Trần giảm 50% theo Nghị định 81/2018 (spec M5, chờ chủ DN xác nhận). */
const CAP_PERCENT = 50n

const floorToStep = (amount: bigint) => (amount / STEP) * STEP

export function inScope(line: DiscountLine, rule: DiscountRule): boolean {
  const brandOk = rule.brandIds.length === 0 || rule.brandIds.includes(line.brandId)
  const categoryOk = rule.categoryIds.length === 0 || line.categoryPath.some((id) => rule.categoryIds.includes(id))
  return brandOk && categoryOk
}

/**
 * Tiền giảm của một mã cho các dòng đơn (GLOSSARY "Mã giảm giá"), dùng chung cho báo giá và tạo đơn để hai bên không
 * bao giờ tính lệch nhau. Mọi số tính trên tiền hàng của các dòng thuộc phạm vi.
 */
export function computeDiscount(lines: readonly DiscountLine[], rule: DiscountRule): DiscountResult {
  const scoped = lines
    .map((line) => ({ line, subtotal: line.price * BigInt(line.quantity) }))
    .filter(({ line }) => inScope(line, rule))
  const scopeSubtotal = scoped.reduce((sum, { subtotal }) => sum + subtotal, 0n)
  if (scopeSubtotal === 0n) return { ok: false, reason: 'not_applicable' }
  if (scopeSubtotal < rule.minSubtotal)
    return { ok: false, reason: 'below_minimum', shortfall: rule.minSubtotal - scopeSubtotal }

  const raw =
    rule.kind === 'fixed'
      ? rule.amount
      : min(floorToStep((scopeSubtotal * BigInt(rule.percent)) / 100n), rule.maxDiscount)
  const discount = min(raw, floorToStep((scopeSubtotal * CAP_PERCENT) / 100n))
  // Làm tròn xuống 1.000 có thể ra 0 (tỷ lệ nhỏ trên tiền hàng nhỏ): đơn không được giảm gì thì không chiếm lượt.
  if (discount === 0n) return { ok: false, reason: 'not_applicable' }

  // Chia theo tỷ lệ tiền hàng, làm tròn xuống tới đồng; phần lẻ vào dòng lớn nhất (bằng nhau thì dòng đầu).
  const shares = new Map(scoped.map(({ line, subtotal }) => [line.variantId, (discount * subtotal) / scopeSubtotal]))
  const largest = scoped.reduce((best, item) => (item.subtotal > best.subtotal ? item : best))
  const allocated = [...shares.values()].reduce((sum, share) => sum + share, 0n)
  shares.set(largest.line.variantId, shares.get(largest.line.variantId)! + discount - allocated)

  return {
    ok: true,
    discount,
    lines: lines.map(({ variantId }) => ({ variantId, discount: shares.get(variantId) ?? 0n })),
  }
}

const min = (a: bigint, b: bigint) => (a < b ? a : b)
