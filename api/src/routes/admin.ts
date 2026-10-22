import { Router } from 'express'
import type { StaffProfile } from '@ecommerce/shared'
import { currentStaff } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { adminAuditRoutes } from './admin-audit.ts'
import { adminPageRoutes } from './admin-pages.ts'
import { adminLegalInfoRoutes } from './legal-info.ts'
import { adminStaffRoutes } from './admin-staff.ts'

/** Các route quản trị; đã đi qua `requireAuth` audience staff và `loadStaff`. */
export function adminRoutes(prisma: Db) {
  return Router()
    .get('/me', (req, res) => {
      const body: StaffProfile = currentStaff(req)
      res.json(body)
    })
    .use('/staff', adminStaffRoutes(prisma))
    .use('/audit', adminAuditRoutes(prisma))
    .use('/pages', adminPageRoutes(prisma))
    .use('/legal-info', adminLegalInfoRoutes(prisma))
}
