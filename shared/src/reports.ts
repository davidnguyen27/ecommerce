import { z } from 'zod'
import { ProductType } from './catalog.ts'

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
