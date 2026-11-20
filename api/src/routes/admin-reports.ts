import { Router } from 'express'
import {
  ReportQuery,
  StockReportQuery,
  type CollectionsReport,
  type RevenueReport,
  type StockReport,
  type VoucherReport,
} from '@ecommerce/shared'
import { requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { parse } from '../http/validation.ts'
import { collectionsReport } from '../reports/collections.ts'
import { periodOf } from '../reports/period.ts'
import { revenueReport } from '../reports/revenue.ts'
import { stockReport } from '../reports/stock.ts'
import { voucherReport } from '../reports/vouchers.ts'

/** Báo cáo (M7), mount tại `/reports`; chỉ đọc nên không qua `audited()`. Mọi báo cáo cần `report.view`. */
export function adminReportRoutes(prisma: Db) {
  return Router()
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
}
