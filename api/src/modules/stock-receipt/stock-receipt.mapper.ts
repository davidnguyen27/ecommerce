import type { StockReceipt, StockReceiptPage } from '@ecommerce/shared'
import type { ReceiptDetailRow, ReceiptListRow } from './stock-receipt.repository.ts'

/** Receipt header shared by list and detail; arrival date is a DATE, returned as `YYYY-MM-DD`. */
const toReceiptHeader = (r: ReceiptListRow | ReceiptDetailRow) => ({
  id: r.id,
  supplierName: r.supplierName,
  receivedOn: r.receivedOn.toISOString().slice(0, 10),
  note: r.note,
  createdAt: r.createdAt.toISOString(),
  createdBy: r.createdBy,
})

export function toReceiptSummary(r: ReceiptListRow): StockReceiptPage['items'][number] {
  return {
    ...toReceiptHeader(r),
    lineCount: r.movements.length,
    totalQuantity: r.movements.reduce((sum, m) => sum + m.quantity, 0),
  }
}

export function toReceipt(receipt: ReceiptDetailRow): StockReceipt {
  return {
    ...toReceiptHeader(receipt),
    lines: receipt.movements.map((m) => ({
      variantId: m.variant.id,
      sku: m.variant.sku,
      productName: m.variant.product.name,
      quantity: m.quantity,
      onHandAfter: m.onHandAfter,
    })),
  }
}
