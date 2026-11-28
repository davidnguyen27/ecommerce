import type {
  CancellationReport,
  CollectionsReport,
  ExceptionsReport,
  ReturnsReport,
  RevenueReport,
  StockReport,
  StockReportQuery,
  VoucherReport,
} from '@ecommerce/shared'
import type { z } from 'zod'
import type { Db } from '../../core/db.ts'
import { cancellationReport } from './report-cancellations.ts'
import { collectionsReport } from './report-collections.ts'
import { buildWorkbook } from './report-excel.ts'
import { exceptionsReport } from './report-exceptions.ts'
import {
  cancellationSheets,
  collectionsSheets,
  returnsSheets,
  revenueSheets,
  stockSheets,
  voucherSheets,
} from './report-exports.ts'
import { periodOf, type Period } from './report-period.ts'
import { returnsReport } from './report-returns.ts'
import { revenueReport } from './report-revenue.ts'
import { stockReport } from './report-stock.ts'
import { voucherReport } from './report-vouchers.ts'

/** An Excel export: the file and the name slug, `bao-cao-<slug>-<from>-<to>.xlsx`. */
export type ReportFile = { slug: string; period: Period; file: Buffer }

/**
 * Reports (M7): read-only, so no audit. Each Excel export uses the same calculation as its JSON, so they always match.
 * The report queries live in `report-*.ts`.
 */
export class ReportService {
  constructor(private readonly prisma: Db) {}

  private async xlsx(slug: string, title: string, period: Period, sheets: Parameters<typeof buildWorkbook>[2]) {
    const file: ReportFile = { slug, period, file: await buildWorkbook(title, period, sheets) }
    return file
  }

  revenue(period: Period): Promise<RevenueReport> {
    return revenueReport(this.prisma, period)
  }

  async revenueFile(period: Period) {
    return this.xlsx('doanh-thu', 'Báo cáo doanh thu', period, revenueSheets(await this.revenue(period)))
  }

  collections(period: Period): Promise<CollectionsReport> {
    return collectionsReport(this.prisma, period)
  }

  async collectionsFile(period: Period) {
    return this.xlsx('tien-thu', 'Báo cáo tiền thu', period, collectionsSheets(await this.collections(period)))
  }

  stock(query: z.output<typeof StockReportQuery>): Promise<StockReport> {
    return stockReport(this.prisma, periodOf(query), query)
  }

  async stockFile(query: z.output<typeof StockReportQuery>) {
    const period = periodOf(query)
    const sheets = stockSheets(await stockReport(this.prisma, period, query, { all: true }))
    return this.xlsx('xuat-nhap-ton', 'Báo cáo xuất nhập tồn', period, sheets)
  }

  vouchers(period: Period): Promise<VoucherReport> {
    return voucherReport(this.prisma, period)
  }

  async vouchersFile(period: Period) {
    return this.xlsx('ma-giam-gia', 'Báo cáo mã giảm giá', period, voucherSheets(await this.vouchers(period)))
  }

  cancellations(period: Period): Promise<CancellationReport> {
    return cancellationReport(this.prisma, period)
  }

  async cancellationsFile(period: Period) {
    const sheets = cancellationSheets(await this.cancellations(period))
    return this.xlsx('huy-hoan-tien', 'Báo cáo hủy đơn và hoàn tiền', period, sheets)
  }

  returns(period: Period): Promise<ReturnsReport> {
    return returnsReport(this.prisma, period)
  }

  async returnsFile(period: Period) {
    return this.xlsx('doi-tra', 'Báo cáo đổi trả và bảo hành', period, returnsSheets(await this.returns(period)))
  }

  /** Not per period: what is pending right now. No Excel version. */
  exceptions(): Promise<ExceptionsReport> {
    return exceptionsReport(this.prisma)
  }
}
