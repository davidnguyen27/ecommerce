import { z } from 'zod'
import { AttributeValues } from './attributes.ts'
import { AuditActor } from './audit.ts'
import { ProductType } from './catalog.ts'
import { ProductStatus, Sku, VariantStatus } from './products.ts'
import { PageQuery, pageOf } from './pagination.ts'
import type { Permission } from './staff.ts'

/** Ledger movement kind. */
export const StockMovementKind = z.enum(['receipt', 'adjustment', 'opening', 'sale', 'return'])
export type StockMovementKind = z.infer<typeof StockMovementKind>

/** Adjustment reason: stocktake, damaged, lost, other. */
export const StockAdjustmentReason = z.enum(['stocktake', 'damaged', 'lost', 'other'])
export type StockAdjustmentReason = z.infer<typeof StockAdjustmentReason>

/**
 * Catalog editors, price setters and warehouse staff can view stock and the ledger; changing stock needs
 * `stock.adjust`.
 */
export const STOCK_VIEW_PERMISSIONS = [
  'catalog.edit',
  'price.edit',
  'stock.adjust',
] as const satisfies readonly Permission[]

/**
 * How each adjustment reason takes its number: stocktake enters the counted quantity (`countedQuantity`); damaged and
 * lost enter the decrease; other enters a signed change. The API and the admin form both read this table.
 */
export const ADJUSTMENT_INPUT = {
  stocktake: { field: 'countedQuantity', mode: 'count' },
  damaged: { field: 'quantity', mode: 'decrease' },
  lost: { field: 'quantity', mode: 'decrease' },
  other: { field: 'quantity', mode: 'signed' },
} as const satisfies Record<StockAdjustmentReason, { field: string; mode: 'count' | 'decrease' | 'signed' }>

/** Signed stock change when staff enter `amount` with this reason while on-hand is `onHand`. */
export function adjustmentDelta(reason: StockAdjustmentReason, amount: number, onHand: number) {
  switch (ADJUSTMENT_INPUT[reason].mode) {
    case 'count':
      return amount - onHand
    case 'decrease':
      return -amount
    case 'signed':
      return amount
  }
}

const Quantity = z.number().int().min(-1_000_000).max(1_000_000)
const Note = z.string().trim().max(1000).default('')

const AdjustmentBase = z.object({
  variantId: z.uuid(),
  /**
   * On-hand when the form opened; a mismatch with the current value is rejected so a concurrent change is not
   * overwritten.
   */
  expectedOnHand: z.number().int().min(0),
  note: Note,
})

/**
 * One stock adjustment of a variant. Stocktake sends the counted quantity; damaged and lost send the decrease; other
 * sends a signed change and requires a note.
 */
export const StockAdjustmentRequest = z.discriminatedUnion('reason', [
  AdjustmentBase.extend({ reason: z.literal('stocktake'), countedQuantity: Quantity.min(0) }),
  AdjustmentBase.extend({ reason: z.literal('damaged'), quantity: Quantity.min(1) }),
  AdjustmentBase.extend({ reason: z.literal('lost'), quantity: Quantity.min(1) }),
  AdjustmentBase.extend({
    reason: z.literal('other'),
    quantity: Quantity.refine((q) => q !== 0, 'Số lượng phải khác 0'),
    note: z.string().trim().min(1, 'Cần ghi chú khi chọn lý do "Khác"').max(1000),
  }),
])
export type StockAdjustmentRequest = z.input<typeof StockAdjustmentRequest>

/** A variant's stock on the admin page. */
export const StockItem = z.object({
  variantId: z.string(),
  sku: z.string(),
  attributes: AttributeValues,
  status: VariantStatus,
  onHand: z.number(),
  /** Reserved for orders (ADR 0007), part of `onHand`. */
  reserved: z.number(),
  product: z.object({ id: z.string(), name: z.string(), productType: ProductType, status: ProductStatus }),
  brand: z.object({ id: z.string(), name: z.string() }),
})
export type StockItem = z.infer<typeof StockItem>

export const StockSort = z.enum(['on_hand_asc', 'on_hand_desc', 'name'])
export type StockSort = z.infer<typeof StockSort>

/** Query string of `GET /api/admin/stock`. `q` searches SKU or product name. */
export const StockQuery = z.object({
  q: z.string().trim().max(200).optional(),
  productType: ProductType.optional(),
  brandId: z.uuid().optional(),
  status: VariantStatus.optional(),
  sort: StockSort.default('name'),
  ...PageQuery.shape,
})
export type StockQuery = z.infer<typeof StockQuery>

export const StockPage = pageOf(StockItem)
export type StockPage = z.infer<typeof StockPage>

/** One ledger row. */
export const StockMovement = z.object({
  id: z.string(),
  kind: StockMovementKind,
  /** Signed: positive increases, negative decreases. */
  quantity: z.number(),
  onHandAfter: z.number(),
  reason: StockAdjustmentReason.nullable(),
  note: z.string(),
  /** The receipt of a receipt row; `null` for other kinds. */
  receiptId: z.string().nullable(),
  /** Order code of a sale or return row; `null` for other kinds. */
  orderCode: z.number().nullable(),
  /** Support request code of a restock (return) or sale (exchange shipment) row; `null` for other kinds. */
  supportRequestCode: z.number().nullable(),
  variant: z.object({ id: z.string(), sku: z.string() }),
  product: z.object({ id: z.string(), name: z.string() }),
  actor: AuditActor,
  createdAt: z.string(),
})
export type StockMovement = z.infer<typeof StockMovement>

/** Query string of `GET /api/admin/stock/movements`. The range is `from <= createdAt < to`. */
export const StockMovementQuery = z.object({
  variantId: z.uuid().optional(),
  kind: StockMovementKind.optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  ...PageQuery.shape,
})
export type StockMovementQuery = z.infer<typeof StockMovementQuery>

export const StockMovementPage = pageOf(StockMovement)
export type StockMovementPage = z.infer<typeof StockMovementPage>

// Stock receipts

/** Records a stock arrival: several SKU and quantity lines, all written or none. SKUs must be unique. */
export const StockReceiptRequest = z.object({
  supplierName: z.string().trim().min(1, 'Cần tên nhà cung cấp').max(200),
  /** Arrival date, `YYYY-MM-DD`. */
  receivedOn: z.iso.date(),
  note: Note,
  lines: z
    .array(z.object({ sku: Sku, quantity: z.number().int().min(1).max(1_000_000) }))
    .min(1, 'Phiếu cần ít nhất một dòng')
    .max(500),
})
export type StockReceiptRequest = z.input<typeof StockReceiptRequest>

/** Body of `POST /api/admin/stock/receipts/preview`: the planned lines, checked as when recording. */
export const StockReceiptPreviewRequest = StockReceiptRequest.pick({ lines: true })
export type StockReceiptPreviewRequest = z.input<typeof StockReceiptPreviewRequest>

/**
 * How the planned arrival would be allocated, writing nothing (ADR 0013): units reserved at once for waiting deposited
 * pre-orders, orders allocated, orders becoming fully arrived, and units left as regular stock. May differ at record
 * time if a deposit lands in between.
 */
export const StockReceiptPreview = z.object({
  lines: z.array(
    z.object({
      sku: z.string(),
      quantity: z.number(),
      forPreorders: z.number(),
      preorderOrders: z.number(),
      ordersCompleted: z.number(),
      toStock: z.number(),
    }),
  ),
})
export type StockReceiptPreview = z.infer<typeof StockReceiptPreview>

const ReceiptHeader = z.object({
  id: z.string(),
  supplierName: z.string(),
  receivedOn: z.string(),
  note: z.string(),
  createdAt: z.string(),
  createdBy: AuditActor,
})

export const StockReceipt = ReceiptHeader.extend({
  lines: z.array(
    z.object({
      variantId: z.string(),
      sku: z.string(),
      productName: z.string(),
      quantity: z.number(),
      onHandAfter: z.number(),
    }),
  ),
})
export type StockReceipt = z.infer<typeof StockReceipt>

export const StockReceiptQuery = PageQuery
export type StockReceiptQuery = z.infer<typeof StockReceiptQuery>

export const StockReceiptPage = pageOf(ReceiptHeader.extend({ lineCount: z.number(), totalQuantity: z.number() }))
export type StockReceiptPage = z.infer<typeof StockReceiptPage>
