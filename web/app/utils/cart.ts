import { CartLines, MAX_CART_LINES, MAX_QUANTITY_PER_VARIANT, type CartLine, type QuoteLine } from '@ecommerce/shared'

/** Một dòng giỏ trong localStorage: biến thể, số lượng và giá khách thấy lúc thêm, để phát hiện đổi giá. */
export type SavedCartLine = CartLine & { price: number }

const isPrice = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0

/** Đọc giỏ đã lưu; thiếu, JSON hỏng hoặc sai dạng thì coi như giỏ rỗng. */
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

/** `limit`: biến thể đã đủ số cái tối đa; `full`: giỏ đã đủ số dòng tối đa. */
export type AddToCartResult = { ok: true; lines: SavedCartLine[] } | { ok: false; reason: 'limit' | 'full' }

/** Thêm một cái của biến thể; cùng biến thể thì cộng dồn và lấy giá vừa thấy. */
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

/** Đổi số lượng một dòng, kẹp trong 1 tới số cái tối đa mỗi biến thể. */
export function setQuantity(lines: readonly SavedCartLine[], variantId: string, quantity: number): SavedCartLine[] {
  const clamped = Math.min(MAX_QUANTITY_PER_VARIANT, Math.max(1, Math.trunc(quantity) || 1))
  return lines.map((line) => (line.variantId === variantId ? { ...line, quantity: clamped } : line))
}

export const removeLine = (lines: readonly SavedCartLine[], variantId: string) =>
  lines.filter((line) => line.variantId !== variantId)

/** Tổng số cái trong giỏ, hiện ở biểu tượng giỏ. */
export const cartCount = (lines: readonly SavedCartLine[]) => lines.reduce((sum, line) => sum + line.quantity, 0)

type QuotedLine = Pick<QuoteLine, 'variantId' | 'price' | 'discontinued' | 'inStock'>

export type CartLineChange =
  { kind: 'price'; from: number; to: number } | { kind: 'discontinued' } | { kind: 'out_of_stock' }

/** Thay đổi của từng dòng so với lúc khách thêm vào giỏ, theo variant id; dòng không đổi thì không có trong map. */
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

/** Khách đồng ý giá hiện tại: giỏ lưu giá mới làm giá đã thấy. Dòng ngừng bán giữ giá cũ. */
export function acceptQuotedPrices(lines: readonly SavedCartLine[], quoted: QuotedLine[]): SavedCartLine[] {
  const current = new Map(quoted.map((line) => [line.variantId, line.price]))
  return lines.map((line) => ({ ...line, price: current.get(line.variantId) ?? line.price }))
}
