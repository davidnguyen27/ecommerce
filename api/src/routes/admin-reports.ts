import { Router } from 'express'
import {
  ReportQuery,
  StockReportQuery,
  type CancellationReport,
  type CollectionsReport,
  type ExceptionsReport,
  type ReturnsReport,
  type RevenueReport,
  type StockReport,
  type VoucherReport,
} from '@ecommerce/shared'
import { requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { parse } from '../http/validation.ts'
import { cancellationReport } from '../reports/cancellations.ts'
import { collectionsReport } from '../reports/collections.ts'
import { exceptionsReport } from '../reports/exceptions.ts'
import { periodOf } from '../reports/period.ts'
import { returnsReport } from '../reports/returns.ts'
import { revenueReport } from '../reports/revenue.ts'
import { stockReport } from '../reports/stock.ts'
import { voucherReport } from '../reports/vouchers.ts'

/** Báo cáo (M7), mount tại `/reports`; chỉ đọc nên không qua `audited()`. Mọi báo cáo cần `report.view`. */
export function adminReportRoutes(prisma: Db) {
  return (
    Router()
      .use(requirePermission('report.view'))
      .get('/revenue', async (req, res) => {
        const period = periodOf(parse(ReportQuery, req.query))
        const body: RevenueReport = await revenueReport(prisma, period)
        res.json(body)
      })
      .get('/collections', async (req, res) => {
        const period = periodOf(parse(ReportQuery, req.query))
        const body: CollectionsReport = await collectionsReport(prisma, period)
        res.json(body)
      })
      .get('/stock', async (req, res) => {
        const query = parse(StockReportQuery, req.query)
        const body: StockReport = await stockReport(prisma, periodOf(query), query)
        res.json(body)
      })
      .get('/vouchers', async (req, res) => {
        const period = periodOf(parse(ReportQuery, req.query))
        const body: VoucherReport = await voucherReport(prisma, period)
        res.json(body)
      })
      .get('/cancellations', async (req, res) => {
        const period = periodOf(parse(ReportQuery, req.query))
        const body: CancellationReport = await cancellationReport(prisma, period)
        res.json(body)
      })
      .get('/returns', async (req, res) => {
        const period = periodOf(parse(ReportQuery, req.query))
        const body: ReturnsReport = await returnsReport(prisma, period)
        res.json(body)
      })
      // Không theo kỳ: việc đang chờ tại thời điểm xem.
      .get('/exceptions', async (_req, res) => {
        const body: ExceptionsReport = await exceptionsReport(prisma)
        res.json(body)
      })
  )
}
