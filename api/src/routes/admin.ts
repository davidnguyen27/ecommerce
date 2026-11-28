import { Router } from 'express'
import type { StaffProfile } from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { currentStaff } from '../core/middleware/staff-context.ts'
import { adminAuditRoutes } from './admin-audit.ts'
import { adminChatbotReportRoutes, adminChatbotRoutes } from './admin-chatbot.ts'
import { adminPageRoutes } from './admin-pages.ts'
import { adminReportRoutes } from './admin-reports.ts'
import { adminLegalInfoRoutes } from './legal-info.ts'
import { adminStaffRoutes } from './admin-staff.ts'

/** Admin routes; behind `requireAuth` for the staff audience and `loadStaff`. */
export function adminRoutes({ prisma, llm }: Pick<AppDeps, 'prisma' | 'llm'>) {
  return (
    Router()
      .get('/me', (req, res) => {
        const body: StaffProfile = currentStaff(req)
        res.json(body)
      })
      .use('/staff', adminStaffRoutes(prisma))
      .use('/audit', adminAuditRoutes(prisma))
      .use('/pages', adminPageRoutes(prisma))
      .use('/legal-info', adminLegalInfoRoutes(prisma))
      // Before the M7 report router: it requires `report.view` for everything below it.
      .use('/reports/chatbot', adminChatbotReportRoutes(prisma))
      .use('/reports', adminReportRoutes(prisma))
      .use('/chatbot', adminChatbotRoutes(prisma, llm))
  )
}
