/** An order line as the discount function needs it: scope uses the product's brand and category chain. */
export type DiscountLine = {
  variantId: string
  brandId: string
  /** The product's category and all its ancestors, in any order. */
  categoryPath: readonly string[]
  /** Sale price in VND. */
  price: bigint
  quantity: number
}

/** The voucher's pricing conditions; validity, status and uses are checked by the caller. */
export type DiscountRule = (
  { kind: 'fixed'; amount: bigint } | { kind: 'percent'; percent: number; maxDiscount: bigint }
) & {
  minSubtotal: bigint
  /** Empty means no brand restriction. */
  brandIds: readonly string[]
  /** Empty means no category restriction; a category includes its descendants. */
  categoryIds: readonly string[]
}

export type DiscountResult =
  | { ok: true; discount: bigint; lines: { variantId: string; discount: bigint }[] }
  | { ok: false; reason: 'not_applicable' }
  | { ok: false; reason: 'below_minimum'; shortfall: bigint }

const STEP = 1000n
/** 50% discount cap per Decree 81/2018 (spec M5, pending owner confirmation). */
const CAP_PERCENT = 50n

const floorToStep = (amount: bigint) => (amount / STEP) * STEP

export function inScope(line: DiscountLine, rule: DiscountRule): boolean {
  const brandOk = rule.brandIds.length === 0 || rule.brandIds.includes(line.brandId)
  const categoryOk = rule.categoryIds.length === 0 || line.categoryPath.some((id) => rule.categoryIds.includes(id))
  return brandOk && categoryOk
}

/**
 * A voucher's discount for the order lines (GLOSSARY "Mã giảm giá"), shared by quote and placement so they never
 * disagree. Everything is computed on the goods of in-scope lines.
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
  // Rounding down to 1,000 can give 0 (small percent on small goods): an order with no discount takes no use.
  if (discount === 0n) return { ok: false, reason: 'not_applicable' }

  // Split by goods share, rounded down to the dong; the remainder goes to the largest line (ties: the first).
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
