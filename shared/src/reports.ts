import { z } from 'zod'
import { ProductType } from './catalog.ts'
import { OrderCancelCause, OrderCancelReason, ReconciliationReason, VoucherKind } from './orders.ts'
import { RefundStatus } from './refunds.ts'
import { SupportRequestKind, SupportReturnReason, WarrantyOutcome } from './support.ts'

/** Longest date range of a report, both ends included. */
export const REPORT_MAX_DAYS = 366

const DAY = 24 * 60 * 60_000

/** Days in the `from`–`to` range (calendar days `YYYY-MM-DD`), both ends included. */
export const reportDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY + 1

export const ReportGroupBy = z.enum(['day', 'month'])
export type ReportGroupBy = z.infer<typeof ReportGroupBy>

const ReportPeriodShape = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  groupBy: ReportGroupBy.default('day'),
})

/** Checks the date range; separate from the schema since zod cannot `extend` a refined schema. */
const checkPeriod = (query: { from: string; to: string }, ctx: z.RefinementCtx) => {
  const days = reportDays(query.from, query.to)
  if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Ngày kết thúc phải sau ngày bắt đầu' })
  else if (days > REPORT_MAX_DAYS)
    ctx.addIssue({ code: 'custom', path: ['to'], message: `Kỳ báo cáo dài tối đa ${REPORT_MAX_DAYS} ngày` })
}

/** Report period: Vietnam-time calendar days, from the start of `from` to the end of `to`. */
export const ReportQuery = ReportPeriodShape.superRefine(checkPeriod)
export type ReportQuery = z.infer<typeof ReportQuery>

/** Rows per page of the stock movement report. */
export const STOCK_REPORT_PAGE_SIZE = 100

/** Stock movement report query: period (`groupBy` ignored), filters and page. */
export const StockReportQuery = ReportPeriodShape.extend({
  productType: ProductType.optional(),
  brandId: z.uuid().optional(),
  /** Only variants with movements in the period. */
  movedOnly: z.stringbool().default(false),
  page: z.coerce.number().int().min(1).default(1),
}).superRefine(checkPeriod)
export type StockReportQuery = z.infer<typeof StockReportQuery>

/** Figures of one revenue period (GLOSSARY "Doanh thu", ADR 0016), VND. */
export const RevenueFigures = z.object({
  /** Orders delivered in the period. */
  deliveredOrders: z.number().int(),
  /** Gross revenue of in-stock orders and of pre-orders; `gross` is their sum. */
  grossStandard: z.number().int(),
  grossPreorder: z.number().int(),
  gross: z.number().int(),
  /** Returns: return refunds completed in the period. */
  returns: z.number().int(),
  /** Net revenue = gross − returns. */
  net: z.number().int(),
  /** Shipping fees of delivered orders; not revenue. */
  shippingFees: z.number().int(),
  /** Forfeited deposits of pre-orders cancelled in the period; not revenue. */
  forfeitedDeposits: z.number().int(),
})
export type RevenueFigures = z.infer<typeof RevenueFigures>

/** Quantity and gross revenue of a group of delivered order lines; returns not deducted. */
const SalesFigures = z.object({ quantity: z.number().int(), gross: z.number().int() })

/** Max SKUs in the top SKU table. */
export const REVENUE_TOP_SKUS = 50

export const RevenueReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  groupBy: ReportGroupBy,
  /** Each day (`YYYY-MM-DD`) or month (`YYYY-MM`) of the period, empty ones included. */
  rows: z.array(RevenueFigures.extend({ period: z.string() })),
  total: RevenueFigures,
  /** By the product's current type and brand, gross revenue descending. */
  byProductType: z.array(SalesFigures.extend({ productType: ProductType })),
  byBrand: z.array(SalesFigures.extend({ brandId: z.string(), brandName: z.string() })),
  /** At most `REVENUE_TOP_SKUS` variants, gross revenue descending. */
  topSkus: z.array(SalesFigures.extend({ variantId: z.string(), sku: z.string(), productName: z.string() })),
})
export type RevenueReport = z.infer<typeof RevenueReport>

/** Collections of one period (GLOSSARY "Tiền thu"), VND. */
export const CollectionsFigures = z.object({
  /** Money in by date received, split by payment purpose; `received` is the total. */
  receivedFull: z.number().int(),
  receivedDeposit: z.number().int(),
  receivedRemainder: z.number().int(),
  received: z.number().int(),
  /** Money out: refunds completed by completion date, split by origin (retries count as their original's origin). */
  refundedCancellation: z.number().int(),
  refundedReconciliation: z.number().int(),
  refundedReturn: z.number().int(),
  refunded: z.number().int(),
  /** Net collections = in − out. */
  net: z.number().int(),
})
export type CollectionsFigures = z.infer<typeof CollectionsFigures>

const CountedAmount = z.object({ count: z.number().int(), amount: z.number().int() })

/** Point-in-time figures, not per period. */
export const CollectionsSnapshot = z.object({
  /** Received minus refunded for undelivered, uncancelled pre-orders; `count` is the order count. */
  depositsHeld: CountedAmount,
  /** Remaining balance of deposited, not fully paid, uncancelled pre-orders; `count` is the order count. */
  outstanding: CountedAmount,
  /** Refunds pending or gateway processing. */
  refunding: CountedAmount,
  /** Open reconciliation items. */
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

/** One variant's stock movement in the period (GLOSSARY "Tồn đầu" / "Tồn cuối"). */
export const StockFigures = z.object({
  opening: z.number().int(),
  /** Receipts and opening stock. */
  received: z.number().int(),
  /** Sales, exchange shipments included. */
  sold: z.number().int(),
  /** Goods back: after failed deliveries, and customer returns or exchanges. */
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
  /** Totals of every matching row, not just this page. */
  totals: StockFigures,
  /** Brands with variants in the ledger, for the filter (accounting cannot read the catalog brand list). */
  brands: z.array(z.object({ id: z.string(), name: z.string() })),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
})
export type StockReport = z.infer<typeof StockReport>

/** Voucher performance, over uncancelled orders created in the period. */
export const VoucherFigures = z.object({
  /** Uses: uncancelled orders with the voucher (GLOSSARY "Lượt dùng"). */
  redemptions: z.number().int(),
  /** Total discount snapshotted on orders. */
  discount: z.number().int(),
  /** Goods after discount of those orders. */
  netGoods: z.number().int(),
  /** How many of them were delivered, as of viewing. */
  deliveredOrders: z.number().int(),
})
export type VoucherFigures = z.infer<typeof VoucherFigures>

export const VoucherReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  /**
   * Each voucher with at least one use in the period, uses descending. Code and amount are the voucher's current ones.
   */
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

/** Orders split by sale type; `total` is their sum. */
const KindCounts = z.object({ standard: z.number().int(), preorder: z.number().int(), total: z.number().int() })

/** Refund origin in reports; retries count as their original's origin. */
export const ReportRefundOrigin = z.enum(['cancellation', 'reconciliation', 'return'])
export type ReportRefundOrigin = z.infer<typeof ReportRefundOrigin>

/** Cancellations and refunds of orders and refunds created in the period (GLOSSARY "Đơn đã xác nhận", "Đơn bỏ dở"). */
export const CancellationReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  /** Confirmed orders created in the period: the cancel rate's denominator. */
  confirmed: KindCounts,
  /** Confirmed orders that were cancelled (cancelled after payment). */
  cancelled: KindCounts,
  /** Cancel rate 0–1; `null` without confirmed orders. */
  rate: z.object({ standard: z.number().nullable(), preorder: z.number().nullable(), total: z.number().nullable() }),
  /** Every cancel cause, including those with no orders. */
  byCause: z.array(KindCounts.extend({ cause: OrderCancelCause })),
  /** Abandoned orders created in the period by cancel reason; not in the cancel rate. */
  abandoned: z.array(z.object({ reason: OrderCancelReason, count: z.number().int() })),
  abandonedTotal: z.number().int(),
  /** Refunds created in the period by origin and current status; only non-empty cells. */
  refunds: z.array(
    z.object({ origin: ReportRefundOrigin, status: RefundStatus, count: z.number().int(), amount: z.number().int() }),
  ),
})
export type CancellationReport = z.infer<typeof CancellationReport>

/** Request type in the returns report. */
export const ReturnKind = z.enum(['return', 'exchange'])
export type ReturnKind = z.infer<typeof ReturnKind>

/** Warranty outcome in reports: a recorded outcome, rejected intake, or still in progress. */
export const WarrantyReportOutcome = z.enum([...WarrantyOutcome.options, 'declined', 'in_progress'])
export type WarrantyReportOutcome = z.infer<typeof WarrantyReportOutcome>

/** Returns, exchanges and warranty of requests created in the period (spec M7). */
export const ReturnsReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  /** Return and exchange requests by decision; `pending` is undecided. */
  requests: z.array(
    z.object({
      kind: ReturnKind,
      accepted: z.number().int(),
      rejected: z.number().int(),
      pending: z.number().int(),
      total: z.number().int(),
    }),
  ),
  /** Quantities on request lines by reason and product type; exchanges have no reason (`null`). */
  lines: z.array(
    z.object({
      kind: ReturnKind,
      reason: SupportReturnReason.nullable(),
      productType: ProductType,
      quantity: z.number().int(),
    }),
  ),
  /**
   * Return rate per product type: units in accepted returns created in the period / units of orders delivered in the
   * period. Not the same set of orders. `rate` is `null` when nothing was delivered.
   */
  returnRate: z.array(
    z.object({
      productType: ProductType,
      returned: z.number().int(),
      delivered: z.number().int(),
      rate: z.number().nullable(),
    }),
  ),
  /** Warranty requests by outcome, every outcome listed. */
  warranty: z.array(z.object({ outcome: WarrantyReportOutcome, count: z.number().int() })),
  warrantyTotal: z.number().int(),
})
export type ReturnsReport = z.infer<typeof ReturnsReport>

/** One exceptions section: total count and a few top rows. */
const exceptionSection = <T extends z.ZodType>(item: T) => z.object({ count: z.number().int(), items: z.array(item) })

/** Exceptions board on the admin home (spec M7): pending decisions as of viewing. */
export const ExceptionsReport = z.object({
  /** Thresholds in use, so the page shows the right day and unit counts. */
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
  /** Refunds pending or gateway processing, created more than `staleRefundDays` days ago. */
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
  /** Undelivered, uncancelled pre-orders past the last day of their expected delivery. */
  latePreorders: exceptionSection(
    z.object({ orderCode: z.number().int(), productName: z.string(), deliveryTo: z.iso.date() }),
  ),
  unassignedSupport: exceptionSection(
    z.object({ code: z.number().int(), kind: SupportRequestKind, subject: z.string(), createdAt: z.string() }),
  ),
  /** Variants on sale of published products with at most `lowStock` sellable units (on-hand − reserved). */
  lowStock: exceptionSection(
    z.object({ variantId: z.string(), sku: z.string(), productName: z.string(), available: z.number().int() }),
  ),
})
export type ExceptionsReport = z.infer<typeof ExceptionsReport>

/** Chatbot figures for one period (M8): conversations by start time, messages by send time. */
export const ChatbotFigures = z.object({
  conversations: z.number().int(),
  customerMessages: z.number().int(),
  /** Conversations started in the period that became support requests. */
  handedOff: z.number().int(),
})
export type ChatbotFigures = z.infer<typeof ChatbotFigures>

/** Chatbot report (`GET /api/admin/reports/chatbot`, permission `chatbot.manage`). */
export const ChatbotReport = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  groupBy: ReportGroupBy,
  rows: z.array(ChatbotFigures.extend({ period: z.string() })),
  total: ChatbotFigures.extend({
    /** Handed-off over started conversations in the period; `null` without conversations. */
    handoffRate: z.number().nullable(),
    /** Customer messages unanswered because every model was out of quota, and because of errors. */
    exhaustedTurns: z.number().int(),
    failedTurns: z.number().int(),
  }),
  /** Per model, per `chat_usage_day` day; busiest models first. */
  models: z.array(
    z.object({
      model: z.string(),
      calls: z.number().int(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      rateLimited: z.number().int(),
      errors: z.number().int(),
    }),
  ),
})
export type ChatbotReport = z.infer<typeof ChatbotReport>
