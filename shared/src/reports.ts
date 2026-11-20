import { z } from 'zod'
import { ProductType } from './catalog.ts'
import { OrderCancelCause, OrderCancelReason, ReconciliationReason, VoucherKind } from './orders.ts'
import { RefundStatus } from './refunds.ts'
import { SupportRequestKind, SupportReturnReason, WarrantyOutcome } from './support.ts'

/** Khoảng ngày dài nhất của một báo cáo, tính cả hai đầu. */
export const REPORT_MAX_DAYS = 366

const DAY = 24 * 60 * 60_000

/** Số ngày của khoảng `from`–`to` (ngày lịch `YYYY-MM-DD`), tính cả hai đầu. */
export const reportDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY + 1

export const ReportGroupBy = z.enum(['day', 'month'])
export type ReportGroupBy = z.infer<typeof ReportGroupBy>

const ReportPeriodShape = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  groupBy: ReportGroupBy.default('day'),
})

/** Kiểm khoảng ngày; tách khỏi schema vì zod không cho `extend` một schema đã có refine. */
const checkPeriod = (query: { from: string; to: string }, ctx: z.RefinementCtx) => {
  const days = reportDays(query.from, query.to)
  if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Ngày kết thúc phải sau ngày bắt đầu' })
  else if (days > REPORT_MAX_DAYS)
    ctx.addIssue({ code: 'custom', path: ['to'], message: `Kỳ báo cáo dài tối đa ${REPORT_MAX_DAYS} ngày` })
}

/** Kỳ báo cáo: ngày lịch theo giờ Việt Nam, từ đầu ngày `from` tới hết ngày `to`. */
export const ReportQuery = ReportPeriodShape.superRefine(checkPeriod)
export type ReportQuery = z.infer<typeof ReportQuery>

/** Số dòng mỗi trang của báo cáo xuất nhập tồn. */
export const STOCK_REPORT_PAGE_SIZE = 100

/** Query của báo cáo xuất nhập tồn: kỳ (bỏ qua `groupBy`), bộ lọc và trang. */
export const StockReportQuery = ReportPeriodShape.extend({
  productType: ProductType.optional(),
  brandId: z.uuid().optional(),
  /** Chỉ biến thể có biến động trong kỳ. */
  movedOnly: z.stringbool().default(false),
  page: z.coerce.number().int().min(1).default(1),
}).superRefine(checkPeriod)
export type StockReportQuery = z.infer<typeof StockReportQuery>

/** Số của một kỳ doanh thu (GLOSSARY "Doanh thu", ADR 0016), VND. */
export const RevenueFigures = z.object({
  /** Số đơn đã giao trong kỳ. */
  deliveredOrders: z.number().int(),
  /** Doanh thu gộp của đơn hàng sẵn và của đơn đặt trước; `gross` là tổng hai số. */
  grossStandard: z.number().int(),
  grossPreorder: z.number().int(),
  gross: z.number().int(),
  /** Hàng trả lại: các khoản hoàn của trả hàng đã xong trong kỳ. */
  returns: z.number().int(),
  /** Doanh thu thuần = gộp − hàng trả lại. */
  net: z.number().int(),
  /** Phí giao của các đơn đã giao; không thuộc doanh thu. */
  shippingFees: z.number().int(),
  /** Mất cọc của đơn đặt trước bị hủy trong kỳ; không thuộc doanh thu. */
  forfeitedDeposits: z.number().int(),
})
export type RevenueFigures = z.infer<typeof RevenueFigures>

/** Số lượng và doanh thu gộp của một nhóm dòng đơn đã giao; không trừ hàng trả lại. */
const SalesFigures = z.object({ quantity: z.number().int(), gross: z.number().int() })

/** Số SKU nhiều nhất trong bảng top SKU. */
export const REVENUE_TOP_SKUS = 50

export const RevenueReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  groupBy: ReportGroupBy,
  /** Mỗi ngày (`YYYY-MM-DD`) hay mỗi tháng (`YYYY-MM`) của kỳ, kể cả kỳ không có số. */
  rows: z.array(RevenueFigures.extend({ period: z.string() })),
  total: RevenueFigures,
  /** Theo nhóm hàng và thương hiệu hiện tại của sản phẩm, doanh thu gộp giảm dần. */
  byProductType: z.array(SalesFigures.extend({ productType: ProductType })),
  byBrand: z.array(SalesFigures.extend({ brandId: z.string(), brandName: z.string() })),
  /** Tối đa `REVENUE_TOP_SKUS` biến thể, doanh thu gộp giảm dần. */
  topSkus: z.array(SalesFigures.extend({ variantId: z.string(), sku: z.string(), productName: z.string() })),
})
export type RevenueReport = z.infer<typeof RevenueReport>

/** Tiền thu của một kỳ (GLOSSARY "Tiền thu"), VND. */
export const CollectionsFigures = z.object({
  /** Tiền vào theo ngày nhận, chia theo mục đích của khoản thu; `received` là tổng. */
  receivedFull: z.number().int(),
  receivedDeposit: z.number().int(),
  receivedRemainder: z.number().int(),
  received: z.number().int(),
  /** Tiền ra: khoản hoàn đã xong theo ngày xong, chia theo nguồn (khoản tạo lại tính theo nguồn của khoản gốc). */
  refundedCancellation: z.number().int(),
  refundedReconciliation: z.number().int(),
  refundedReturn: z.number().int(),
  refunded: z.number().int(),
  /** Tiền thu thuần = tiền vào − tiền ra. */
  net: z.number().int(),
})
export type CollectionsFigures = z.infer<typeof CollectionsFigures>

const CountedAmount = z.object({ count: z.number().int(), amount: z.number().int() })

/** Số tại thời điểm xem, không theo kỳ. */
export const CollectionsSnapshot = z.object({
  /** Tiền đã nhận trừ đã hoàn của đơn đặt trước chưa giao, chưa hủy; `count` là số đơn. */
  depositsHeld: CountedAmount,
  /** Phần còn lại của đơn đặt trước đã cọc, chưa trả đủ, chưa hủy; `count` là số đơn. */
  outstanding: CountedAmount,
  /** Khoản hoàn chờ thực hiện hoặc cổng đang xử lý. */
  refunding: CountedAmount,
  /** Mục cần đối soát đang mở. */
  reconciliation: CountedAmount,
})
export type CollectionsSnapshot = z.infer<typeof CollectionsSnapshot>

export const CollectionsReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  groupBy: ReportGroupBy,
  rows: z.array(CollectionsFigures.extend({ period: z.string() })),
  total: CollectionsFigures,
  snapshot: CollectionsSnapshot,
})
export type CollectionsReport = z.infer<typeof CollectionsReport>

/** Số lượng xuất nhập của một biến thể trong kỳ (GLOSSARY "Tồn đầu" / "Tồn cuối"). */
export const StockFigures = z.object({
  opening: z.number().int(),
  /** Phiếu nhập và tồn đầu kỳ. */
  received: z.number().int(),
  /** Xuất bán, gồm hàng đổi giao đi. */
  sold: z.number().int(),
  /** Hàng hoàn về: sau giao thất bại, và hàng khách trả hay đổi. */
  returned: z.number().int(),
  adjustedUp: z.number().int(),
  adjustedDown: z.number().int(),
  closing: z.number().int(),
})
export type StockFigures = z.infer<typeof StockFigures>

export const StockReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  items: z.array(
    StockFigures.extend({
      variantId: z.string(),
      sku: z.string(),
      productName: z.string(),
      brandName: z.string(),
      productType: ProductType,
    }),
  ),
  /** Tổng của mọi dòng khớp bộ lọc, không chỉ trang này. */
  totals: StockFigures,
  /** Thương hiệu có biến thể trong sổ, cho bộ lọc (kế toán không có quyền đọc danh sách thương hiệu của danh mục). */
  brands: z.array(z.object({ id: z.string(), name: z.string() })),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})
export type StockReport = z.infer<typeof StockReport>

/** Hiệu quả mã giảm giá, theo các đơn chưa hủy tạo trong kỳ. */
export const VoucherFigures = z.object({
  /** Số lượt: số đơn chưa hủy dùng mã (GLOSSARY "Lượt dùng"). */
  redemptions: z.number().int(),
  /** Tổng tiền giảm chụp trên đơn. */
  discount: z.number().int(),
  /** Tiền hàng sau giảm của các đơn đó. */
  netGoods: z.number().int(),
  /** Số đơn trong đó đã giao tới khách, tính tới lúc xem. */
  deliveredOrders: z.number().int(),
})
export type VoucherFigures = z.infer<typeof VoucherFigures>

export const VoucherReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  /** Mỗi mã có ít nhất một lượt trong kỳ, số lượt giảm dần. Mã và mức giảm là của mã hiện tại. */
  items: z.array(
    VoucherFigures.extend({
      voucherId: z.string(),
      code: z.string(),
      kind: VoucherKind,
      amount: z.number().nullable(),
      percent: z.number().nullable(),
      maxDiscount: z.number().nullable(),
    }),
  ),
  totals: VoucherFigures,
})
export type VoucherReport = z.infer<typeof VoucherReport>

/** Số đơn chia theo hình thức bán; `total` là tổng hai số. */
const KindCounts = z.object({ standard: z.number().int(), preorder: z.number().int(), total: z.number().int() })

/** Nguồn của khoản hoàn trong báo cáo; khoản tạo lại tính theo nguồn của khoản gốc. */
export const ReportRefundOrigin = z.enum(['cancellation', 'reconciliation', 'return'])
export type ReportRefundOrigin = z.infer<typeof ReportRefundOrigin>

/** Hủy đơn và hoàn tiền của các đơn, khoản hoàn tạo trong kỳ (GLOSSARY "Đơn đã xác nhận", "Đơn bỏ dở"). */
export const CancellationReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  /** Đơn đã xác nhận tạo trong kỳ: mẫu số của tỷ lệ hủy. */
  confirmed: KindCounts,
  /** Đơn đã xác nhận đã bị hủy (hủy khi đã nhận tiền). */
  cancelled: KindCounts,
  /** Tỷ lệ hủy 0–1; `null` khi không có đơn đã xác nhận. */
  rate: z.object({ standard: z.number().nullable(), preorder: z.number().nullable(), total: z.number().nullable() }),
  /** Mọi lý do hủy, kể cả lý do không có đơn nào. */
  byCause: z.array(KindCounts.extend({ cause: OrderCancelCause })),
  /** Đơn bỏ dở tạo trong kỳ theo lý do hủy; không vào tỷ lệ hủy. */
  abandoned: z.array(z.object({ reason: OrderCancelReason, count: z.number().int() })),
  abandonedTotal: z.number().int(),
  /** Khoản hoàn tạo trong kỳ theo nguồn và trạng thái hiện tại; chỉ các ô có khoản. */
  refunds: z.array(
    z.object({ origin: ReportRefundOrigin, status: RefundStatus, count: z.number().int(), amount: z.number().int() }),
  ),
})
export type CancellationReport = z.infer<typeof CancellationReport>

/** Loại yêu cầu trong báo cáo đổi trả. */
export const ReturnKind = z.enum(['return', 'exchange'])
export type ReturnKind = z.infer<typeof ReturnKind>

/** Kết quả bảo hành trong báo cáo: kết quả đã ghi, từ chối tiếp nhận, hoặc đang xử lý. */
export const WarrantyReportOutcome = z.enum([...WarrantyOutcome.options, 'declined', 'in_progress'])
export type WarrantyReportOutcome = z.infer<typeof WarrantyReportOutcome>

/** Đổi trả và bảo hành của các yêu cầu tạo trong kỳ (spec M7). */
export const ReturnsReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  /** Số yêu cầu trả và đổi theo quyết định; `pending` là chưa quyết. */
  requests: z.array(
    z.object({
      kind: ReturnKind,
      accepted: z.number().int(),
      rejected: z.number().int(),
      pending: z.number().int(),
      total: z.number().int(),
    }),
  ),
  /** Số lượng trên các dòng yêu cầu theo lý do và nhóm hàng; yêu cầu đổi không có lý do (`null`). */
  lines: z.array(
    z.object({
      kind: ReturnKind,
      reason: SupportReturnReason.nullable(),
      productType: ProductType,
      quantity: z.number().int(),
    }),
  ),
  /**
   * Tỷ lệ trả theo nhóm hàng: số cái của yêu cầu trả đã chấp nhận tạo trong kỳ / số cái của đơn giao trong kỳ. Hai số
   * không cùng tập đơn. `rate` là `null` khi không giao cái nào.
   */
  returnRate: z.array(
    z.object({
      productType: ProductType,
      returned: z.number().int(),
      delivered: z.number().int(),
      rate: z.number().nullable(),
    }),
  ),
  /** Yêu cầu bảo hành theo kết quả, đủ mọi kết quả. */
  warranty: z.array(z.object({ outcome: WarrantyReportOutcome, count: z.number().int() })),
  warrantyTotal: z.number().int(),
})
export type ReturnsReport = z.infer<typeof ReturnsReport>

/** Một mục của bảng ngoại lệ: tổng số việc và tối đa vài dòng đầu. */
const exceptionSection = <T extends z.ZodType>(item: T) => z.object({ count: z.number().int(), items: z.array(item) })

/** Bảng ngoại lệ ở trang chủ quản trị (spec M7): việc đang chờ quyết, tính tại thời điểm xem. */
export const ExceptionsReport = z.object({
  /** Ngưỡng đang dùng, để trang ghi đúng số ngày và số cái. */
  thresholds: z.object({ staleRefundDays: z.number().int(), lowStock: z.number().int() }),
  reconciliation: exceptionSection(
    z.object({
      id: z.string(),
      orderCode: z.number().int(),
      reason: ReconciliationReason,
      amount: z.number().int(),
      receivedAt: z.string(),
    }),
  ),
  /** Khoản hoàn chờ thực hiện hay cổng đang xử lý, tạo quá `staleRefundDays` ngày. */
  staleRefunds: exceptionSection(
    z.object({
      id: z.string(),
      orderCode: z.number().int(),
      amount: z.number().int(),
      status: RefundStatus,
      createdAt: z.string(),
    }),
  ),
  overdueRemainders: exceptionSection(
    z.object({ orderCode: z.number().int(), remainingAmount: z.number().int(), remainderDueAt: z.string() }),
  ),
  /** Đơn đặt trước chưa giao, chưa hủy, đã quá ngày cuối của thời gian giao dự kiến. */
  latePreorders: exceptionSection(
    z.object({ orderCode: z.number().int(), productName: z.string(), deliveryTo: z.iso.date() }),
  ),
  unassignedSupport: exceptionSection(
    z.object({ code: z.number().int(), kind: SupportRequestKind, subject: z.string(), createdAt: z.string() }),
  ),
  /** Biến thể đang bán của sản phẩm đã xuất bản, còn bán được (tồn − giữ hàng) không quá `lowStock` cái. */
  lowStock: exceptionSection(
    z.object({ variantId: z.string(), sku: z.string(), productName: z.string(), available: z.number().int() }),
  ),
})
export type ExceptionsReport = z.infer<typeof ExceptionsReport>
