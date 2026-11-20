import { Router } from 'express'
import { ReportQuery, type RevenueReport } from '@ecommerce/shared'
import { requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { parse } from '../http/validation.ts'
import { periodOf } from '../reports/period.ts'
import { revenueReport } from '../reports/revenue.ts'

/** Báo cáo (M7), mount tại `/reports`; chỉ đọc nên không qua `audited()`. Mọi báo cáo cần `report.view`. */
export function adminReportRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('report.view'))
    .get('/revenue', async (req, res) => {
      const period = periodOf(parse(ReportQuery, req.query))
      const body: RevenueReport = await revenueReport(prisma, period)
      res.json(body)
    })
}
