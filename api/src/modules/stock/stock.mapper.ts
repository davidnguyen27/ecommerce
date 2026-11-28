import type { AttributeValues, StockItem, StockMovementPage } from '@ecommerce/shared'
import type { MovementRow, StockRow } from './stock.repository.ts'

export function toStockItem(variant: StockRow): StockItem {
  const { brand, ...product } = variant.product
  return {
    variantId: variant.id,
    sku: variant.sku,
    attributes: variant.attributes as AttributeValues,
    status: variant.status,
    onHand: variant.onHand,
    reserved: variant.reserved,
    product,
    brand,
  }
}

export function toStockMovement({
  variant: { product, ...variant },
  ...m
}: MovementRow): StockMovementPage['items'][number] {
  return {
    id: m.id,
    kind: m.kind,
    quantity: m.quantity,
    onHandAfter: m.onHandAfter,
    reason: m.reason,
    receiptId: m.receiptId,
    orderCode: m.order?.code ?? null,
    supportRequestCode: m.supportRequest?.code ?? null,
    note: m.note,
    variant,
    product,
    actor: m.actor,
    createdAt: m.createdAt.toISOString(),
  }
}
