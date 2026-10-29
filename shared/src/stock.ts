import { z } from 'zod'
import { AuditActor } from './audit.ts'
import { ProductType } from './catalog.ts'
import { ProductStatus, VariantStatus } from './products.ts'

/** Loại biến động trong sổ xuất nhập. */
export const StockMovementKind = z.enum(['receipt', 'adjustment', 'opening'])
export type StockMovementKind = z.infer<typeof StockMovementKind>

/** Lý do điều chỉnh: kiểm kê, hàng hỏng, mất hàng, khác. */
export const StockAdjustmentReason = z.enum(['stocktake', 'damaged', 'lost', 'other'])
export type StockAdjustmentReason = z.infer<typeof StockAdjustmentReason>

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
  attributes: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.number(), z.boolean()])),
  status: VariantStatus,
  onHand: z.number(),
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
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})
export type StockQuery = z.infer<typeof StockQuery>

export const StockPage = z.object({
  items: z.array(StockItem),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})
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
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})
export type StockMovementQuery = z.infer<typeof StockMovementQuery>

export const StockMovementPage = z.object({
  items: z.array(StockMovement),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})
export type StockMovementPage = z.infer<typeof StockMovementPage>
