import { CartLines, MAX_CART_LINES, MAX_QUANTITY_PER_VARIANT, type CartLine, type QuoteLine } from '@ecommerce/shared'

/** A cart line in localStorage: variant, quantity and the price seen when added, to detect price changes. */
export type SavedCartLine = CartLine & { price: number }

const isPrice = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0

/** Reads the saved cart; missing, broken JSON or wrong shape counts as empty. */
export function readCart(raw: string | null): SavedCartLine[] {
  if (!raw) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  if (!CartLines.safeParse(value).success) return []
  const lines = value as SavedCartLine[]
  return lines.every((line) => isPrice(line.price))
    ? lines.map(({ variantId, quantity, price }) => ({ variantId, quantity, price }))
    : []
}

/** `limit`: the variant is at its max; `full`: the cart has the max number of lines. */
export type AddToCartResult = { ok: true; lines: SavedCartLine[] } | { ok: false; reason: 'limit' | 'full' }

/** Adds one unit of a variant; the same variant accumulates and takes the price just seen. */
export function addToCart(
  lines: readonly SavedCartLine[],
  item: { variantId: string; price: number },
): AddToCartResult {
  const existing = lines.find((line) => line.variantId === item.variantId)
  if (!existing) {
    if (lines.length >= MAX_CART_LINES) return { ok: false, reason: 'full' }
    return { ok: true, lines: [...lines, { variantId: item.variantId, quantity: 1, price: item.price }] }
  }
  if (existing.quantity >= MAX_QUANTITY_PER_VARIANT) return { ok: false, reason: 'limit' }
  return {
    ok: true,
    lines: lines.map((line) =>
      line === existing ? { ...line, quantity: line.quantity + 1, price: item.price } : line,
    ),
  }
}

/** Changes a line's quantity, clamped between 1 and the per-variant max. */
export function setQuantity(lines: readonly SavedCartLine[], variantId: string, quantity: number): SavedCartLine[] {
  const clamped = Math.min(MAX_QUANTITY_PER_VARIANT, Math.max(1, Math.trunc(quantity) || 1))
  return lines.map((line) => (line.variantId === variantId ? { ...line, quantity: clamped } : line))
}

export const removeLine = (lines: readonly SavedCartLine[], variantId: string) =>
  lines.filter((line) => line.variantId !== variantId)

/** Total units in the cart, shown on the cart icon. */
export const cartCount = (lines: readonly SavedCartLine[]) => lines.reduce((sum, line) => sum + line.quantity, 0)

type QuotedLine = Pick<QuoteLine, 'variantId' | 'price' | 'discontinued' | 'inStock'>

export type CartLineChange =
  { kind: 'price'; from: number; to: number } | { kind: 'discontinued' } | { kind: 'out_of_stock' }

/** Per-line changes since the customer added them, by variant id; unchanged lines are absent. */
export function cartChanges(lines: readonly SavedCartLine[], quoted: QuotedLine[]): Map<string, CartLineChange> {
  const changes = new Map<string, CartLineChange>()
  const savedPrice = new Map(lines.map((line) => [line.variantId, line.price]))
  for (const line of quoted) {
    const from = savedPrice.get(line.variantId)
    if (from === undefined) continue
    if (line.discontinued || line.price === null) changes.set(line.variantId, { kind: 'discontinued' })
    else if (line.price !== from) changes.set(line.variantId, { kind: 'price', from, to: line.price })
    else if (!line.inStock) changes.set(line.variantId, { kind: 'out_of_stock' })
  }
  return changes
}

/** The customer accepts current prices: the cart stores them as seen. Discontinued lines keep the old price. */
export function acceptQuotedPrices(lines: readonly SavedCartLine[], quoted: QuotedLine[]): SavedCartLine[] {
  const current = new Map(quoted.map((line) => [line.variantId, line.price]))
  return lines.map((line) => ({ ...line, price: current.get(line.variantId) ?? line.price }))
}
