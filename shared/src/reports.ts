import { z } from 'zod'
import { ProductType } from './catalog.ts'

/** Khoảng ngày dài nhất của một báo cáo, tính cả hai đầu. */
export const REPORT_MAX_DAYS = 366

const DAY = 24 * 60 * 60_000

/** Số ngày của khoảng `from`–`to` (ngày lịch `YYYY-MM-DD`), tính cả hai đầu. */
export const reportDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY + 1

export const ReportGroupBy = z.enum(['day', 'month'])
export type ReportGroupBy = z.infer<typeof ReportGroupBy>

/** Kỳ báo cáo: ngày lịch theo giờ Việt Nam, từ đầu ngày `from` tới hết ngày `to`. */
export const ReportQuery = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    groupBy: ReportGroupBy.default('day'),
  })
  .superRefine((query, ctx) => {
    const days = reportDays(query.from, query.to)
    if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Ngày kết thúc phải sau ngày bắt đầu' })
    else if (days > REPORT_MAX_DAYS)
      ctx.addIssue({ code: 'custom', path: ['to'], message: `Kỳ báo cáo dài tối đa ${REPORT_MAX_DAYS} ngày` })
  })
export type ReportQuery = z.infer<typeof ReportQuery>

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
