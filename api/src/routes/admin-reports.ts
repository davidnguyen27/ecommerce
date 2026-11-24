import { Router, type Request, type Response } from 'express'
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
import { XLSX_TYPE, buildWorkbook, type SheetSpec } from '../reports/excel.ts'
import { exceptionsReport } from '../reports/exceptions.ts'
import {
  cancellationSheets,
  collectionsSheets,
  returnsSheets,
  revenueSheets,
  stockSheets,
  voucherSheets,
} from '../reports/exports.ts'
import { periodOf, type Period } from '../reports/period.ts'
import { returnsReport } from '../reports/returns.ts'
import { revenueReport } from '../reports/revenue.ts'
import { stockReport } from '../reports/stock.ts'
import { voucherReport } from '../reports/vouchers.ts'

/** Excel file of a report: `bao-cao-<slug>-<from>-<to>.xlsx`. */
async function sendXlsx(res: Response, slug: string, title: string, period: Period, sheets: SheetSpec[]) {
  const file = await buildWorkbook(title, period, sheets)
  res.type(XLSX_TYPE).attachment(`bao-cao-${slug}-${period.from}-${period.to}.xlsx`).send(file)
}

const periodFrom = (req: Request) => periodOf(parse(ReportQuery, req.query))

/**
 * Reports (M7), mounted at `/reports`; read-only, so no `audited()`, Excel export included. Every report needs
 * `report.view`. The `.xlsx` uses the same calculation as the JSON, so they always match.
 */
export function adminReportRoutes(prisma: Db) {
  return (
    Router()
      .use(requirePermission('report.view'))
      .get('/revenue', async (req, res) => {
        const body: RevenueReport = await revenueReport(prisma, periodFrom(req))
        res.json(body)
      })
      .get('/revenue.xlsx', async (req, res) => {
        const period = periodFrom(req)
        await sendXlsx(
          res,
          'doanh-thu',
          'Báo cáo doanh thu',
          period,
          revenueSheets(await revenueReport(prisma, period)),
        )
      })
      .get('/collections', async (req, res) => {
        const body: CollectionsReport = await collectionsReport(prisma, periodFrom(req))
        res.json(body)
      })
      .get('/collections.xlsx', async (req, res) => {
        const period = periodFrom(req)
        const sheets = collectionsSheets(await collectionsReport(prisma, period))
        await sendXlsx(res, 'tien-thu', 'Báo cáo tiền thu', period, sheets)
      })
      .get('/stock', async (req, res) => {
        const query = parse(StockReportQuery, req.query)
        const body: StockReport = await stockReport(prisma, periodOf(query), query)
        res.json(body)
      })
      .get('/stock.xlsx', async (req, res) => {
        const query = parse(StockReportQuery, req.query)
        const period = periodOf(query)
        const sheets = stockSheets(await stockReport(prisma, period, query, { all: true }))
        await sendXlsx(res, 'xuat-nhap-ton', 'Báo cáo xuất nhập tồn', period, sheets)
      })
      .get('/vouchers', async (req, res) => {
        const body: VoucherReport = await voucherReport(prisma, periodFrom(req))
        res.json(body)
      })
      .get('/vouchers.xlsx', async (req, res) => {
        const period = periodFrom(req)
        const sheets = voucherSheets(await voucherReport(prisma, period))
        await sendXlsx(res, 'ma-giam-gia', 'Báo cáo mã giảm giá', period, sheets)
      })
      .get('/cancellations', async (req, res) => {
        const body: CancellationReport = await cancellationReport(prisma, periodFrom(req))
        res.json(body)
      })
      .get('/cancellations.xlsx', async (req, res) => {
        const period = periodFrom(req)
        const sheets = cancellationSheets(await cancellationReport(prisma, period))
        await sendXlsx(res, 'huy-hoan-tien', 'Báo cáo hủy đơn và hoàn tiền', period, sheets)
      })
      .get('/returns', async (req, res) => {
        const body: ReturnsReport = await returnsReport(prisma, periodFrom(req))
        res.json(body)
      })
      .get('/returns.xlsx', async (req, res) => {
        const period = periodFrom(req)
        const sheets = returnsSheets(await returnsReport(prisma, period))
        await sendXlsx(res, 'doi-tra', 'Báo cáo đổi trả và bảo hành', period, sheets)
      })
      // Not per period: what is pending right now. No Excel version.
      .get('/exceptions', async (_req, res) => {
        const body: ExceptionsReport = await exceptionsReport(prisma)
        res.json(body)
      })
  )
}
