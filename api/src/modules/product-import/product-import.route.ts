import { Router } from 'express'
import { receiveFile } from '../../core/media/upload.ts'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { ProductImportController } from './product-import.controller.ts'

const MAX_BYTES = 5 * 1024 * 1024
const receiveImportFile = receiveFile(MAX_BYTES, 'File import tối đa 5 MB')

/** Import products and variants from an .xlsx file under `/api/admin/import`; everything needs `catalog.edit`. */
export class ProductImportRoute implements IRoute {
  readonly path = '/import'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: ProductImportController) {
    this.router
      .use(requirePermission('catalog.edit'))
      .get('/template', c.template)
      .post('/preview', receiveImportFile, c.preview)
      .post('/commit', receiveImportFile, c.commit)
  }
}
