import { Router } from 'express'
import type { StaffProfile } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { currentStaff } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { adminAttributeSchemaRoutes } from './admin-attribute-schemas.ts'
import { adminAuditRoutes } from './admin-audit.ts'
import { adminBrandRoutes } from './admin-brands.ts'
import { adminCategoryRoutes } from './admin-categories.ts'
import { adminCommitmentTypeRoutes } from './admin-commitment-types.ts'
import { adminPageRoutes } from './admin-pages.ts'
import { adminProductCommitmentRoutes } from './admin-product-commitments.ts'
import { adminProductDocumentRoutes } from './admin-product-documents.ts'
import { adminProductImageRoutes } from './admin-product-images.ts'
import { adminProductPublishingRoutes } from './admin-product-publishing.ts'
import { adminProductRoutes } from './admin-products.ts'
import { adminLegalInfoRoutes } from './legal-info.ts'
import { adminStaffRoutes } from './admin-staff.ts'

/** Các route quản trị; đã đi qua `requireAuth` audience staff và `loadStaff`. */
export function adminRoutes(prisma: Db, storage: Storage) {
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
      .use('/brands', adminBrandRoutes(prisma, storage))
      .use('/categories', adminCategoryRoutes(prisma))
      .use('/attribute-schemas', adminAttributeSchemaRoutes(prisma))
      .use('/commitment-types', adminCommitmentTypeRoutes(prisma))
      // Trước `/products`: ảnh, chứng từ và cam kết có quyền riêng (`media.upload`), không đi qua quyền chung của router sản phẩm.
      .use('/products/:id/images', adminProductImageRoutes(prisma, storage))
      .use('/products/:id', adminProductPublishingRoutes(prisma, storage))
      .use('/products/:id/documents', adminProductDocumentRoutes(prisma, storage))
      .use('/products/:id/commitments', adminProductCommitmentRoutes(prisma))
      .use('/products', adminProductRoutes(prisma))
  )
}
