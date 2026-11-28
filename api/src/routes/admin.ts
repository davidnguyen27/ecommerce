import { Router } from 'express'
import type { StaffProfile } from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { currentStaff } from '../core/middleware/staff-context.ts'
import type { CustomerMail } from '../core/jobs/jobs.ts'
import { adminAuditRoutes } from './admin-audit.ts'
import { adminChatbotReportRoutes, adminChatbotRoutes } from './admin-chatbot.ts'
import { adminPageRoutes } from './admin-pages.ts'
import { adminVoucherRoutes } from './admin-vouchers.ts'
import { adminSupportRoutes } from './admin-support.ts'
import { adminReturnWindowRoutes } from './admin-return-windows.ts'
import { adminReportRoutes } from './admin-reports.ts'
import { adminLegalInfoRoutes } from './legal-info.ts'
import { adminStaffRoutes } from './admin-staff.ts'
import { adminShippingFeeRoutes } from './admin-shipping-fees.ts'

/** Admin routes; behind `requireAuth` for the staff audience and `loadStaff`. */
export function adminRoutes(deps: Pick<AppDeps, 'prisma' | 'storage' | 'emails' | 'siteUrl' | 'llm'>) {
  const { prisma, storage, llm } = deps
  // Mail queue and website URL for support emails.
  const mail: CustomerMail = { emails: deps.emails, siteUrl: deps.siteUrl }
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
      .use('/shipping-fees', adminShippingFeeRoutes(prisma))
      .use('/vouchers', adminVoucherRoutes(prisma))
      .use('/support-requests', adminSupportRoutes(prisma, storage, mail))
      .use('/return-windows', adminReturnWindowRoutes(prisma))
      // Before the M7 report router: it requires `report.view` for everything below it.
      .use('/reports/chatbot', adminChatbotReportRoutes(prisma))
      .use('/reports', adminReportRoutes(prisma))
      .use('/chatbot', adminChatbotRoutes(prisma, llm))
  )
}
