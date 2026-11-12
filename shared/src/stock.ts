import { z } from 'zod'
import { AttributeValues } from './attributes.ts'
import { AuditActor } from './audit.ts'
import { ProductType } from './catalog.ts'
import { ProductStatus, Sku, VariantStatus } from './products.ts'
import { PageQuery, pageOf } from './pagination.ts'
import type { Permission } from './staff.ts'

/** Loại biến động trong sổ xuất nhập. */
export const StockMovementKind = z.enum(['receipt', 'adjustment', 'opening', 'sale'])
export type StockMovementKind = z.infer<typeof StockMovementKind>

/** Lý do điều chỉnh: kiểm kê, hàng hỏng, mất hàng, khác. */
export const StockAdjustmentReason = z.enum(['stocktake', 'damaged', 'lost', 'other'])
export type StockAdjustmentReason = z.infer<typeof StockAdjustmentReason>

/** Ai soạn danh mục, đặt giá hoặc giữ kho đều xem được tồn và sổ xuất nhập; đổi tồn cần `stock.adjust`. */
export const STOCK_VIEW_PERMISSIONS = [
  'catalog.edit',
  'price.edit',
  'stock.adjust',
] as const satisfies readonly Permission[]

/**
 * Cách nhập số của từng lý do điều chỉnh: kiểm kê nhập số đếm thực tế (`countedQuantity`); hỏng, mất nhập số giảm;
 * khác nhập số có dấu. API và form quản trị cùng đọc bảng này.
 */
export const ADJUSTMENT_INPUT = {
  stocktake: { field: 'countedQuantity', mode: 'count' },
  damaged: { field: 'quantity', mode: 'decrease' },
  lost: { field: 'quantity', mode: 'decrease' },
  other: { field: 'quantity', mode: 'signed' },
} as const satisfies Record<StockAdjustmentReason, { field: string; mode: 'count' | 'decrease' | 'signed' }>

/** Thay đổi tồn (có dấu) khi nhân viên nhập `amount` với lý do này, lúc tồn đang là `onHand`. */
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
  /** Tồn lúc nhân viên mở form; khác tồn hiện tại thì bị từ chối để không ghi đè một thay đổi chen vào. */
  expectedOnHand: z.number().int().min(0),
  note: Note,
})

/**
 * Một lần điều chỉnh tồn của một biến thể. Kiểm kê gửi số đếm thực tế; hỏng, mất gửi số giảm;
 * khác gửi số tăng hoặc giảm (có dấu) và bắt buộc ghi chú.
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

/** Tồn của một biến thể ở trang quản trị. */
export const StockItem = z.object({
  variantId: z.string(),
  sku: z.string(),
  attributes: AttributeValues,
  status: VariantStatus,
  onHand: z.number(),
  /** Số đang giữ cho đơn (ADR 0007), nằm trong `onHand`. */
  reserved: z.number(),
  product: z.object({ id: z.string(), name: z.string(), productType: ProductType, status: ProductStatus }),
  brand: z.object({ id: z.string(), name: z.string() }),
})
export type StockItem = z.infer<typeof StockItem>

export const StockSort = z.enum(['on_hand_asc', 'on_hand_desc', 'name'])
export type StockSort = z.infer<typeof StockSort>

/** Query string của `GET /api/admin/stock`. `q` tìm theo SKU hoặc tên sản phẩm. */
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

/** Một dòng sổ xuất nhập. */
export const StockMovement = z.object({
  id: z.string(),
  kind: StockMovementKind,
  /** Có dấu: dương là tăng, âm là giảm. */
  quantity: z.number(),
  onHandAfter: z.number(),
  reason: StockAdjustmentReason.nullable(),
  note: z.string(),
  /** Phiếu nhập của dòng loại nhập kho; loại khác thì `null`. */
  receiptId: z.string().nullable(),
  /** Mã đơn của dòng xuất bán; loại khác thì `null`. */
  orderCode: z.number().nullable(),
  variant: z.object({ id: z.string(), sku: z.string() }),
  product: z.object({ id: z.string(), name: z.string() }),
  actor: AuditActor,
  createdAt: z.string(),
})
export type StockMovement = z.infer<typeof StockMovement>

/** Query string của `GET /api/admin/stock/movements`. Khoảng thời gian tính `from <= createdAt < to`. */
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

// Phiếu nhập

/** Ghi một lô hàng về kho: nhiều dòng SKU và số lượng, ghi toàn bộ hoặc không dòng nào. SKU không được trùng. */
export const StockReceiptRequest = z.object({
  supplierName: z.string().trim().min(1, 'Cần tên nhà cung cấp').max(200),
  /** Ngày hàng về, `YYYY-MM-DD`. */
  receivedOn: z.iso.date(),
  note: Note,
  lines: z
    .array(z.object({ sku: Sku, quantity: z.number().int().min(1).max(1_000_000) }))
    .min(1, 'Phiếu cần ít nhất một dòng')
    .max(500),
})
export type StockReceiptRequest = z.input<typeof StockReceiptRequest>

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
