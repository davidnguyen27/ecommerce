import type { Request, Response } from 'express'
import type { ImportPreview, ImportResult } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { requiredFile } from '../../core/media/upload.ts'
import { hasPermission } from '../../core/middleware/staff-context.ts'
import type { ImportFile } from './product-import.interface.ts'
import type { ProductImportService } from './product-import.service.ts'

/** The uploaded file with the uploader's price and stock permissions. */
function importFileOf(req: Request): ImportFile {
  const file = requiredFile(req, 'Chọn file Excel .xlsx để import')
  return {
    buffer: file.buffer,
    fileName: file.originalname,
    canEditPrice: hasPermission(req, 'price.edit'),
    canAdjustStock: hasPermission(req, 'stock.adjust'),
  }
}

export class ProductImportController {
  constructor(private readonly service: ProductImportService) {}

  template = async (_req: Request, res: Response) => {
    res
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .attachment('mau-import-hang-hoa.xlsx')
      .send(await this.service.template())
  }

  preview = async (req: Request, res: Response) => {
    const body: ImportPreview = await this.service.preview(importFileOf(req))
    res.json(body)
  }

  commit = async (req: Request, res: Response) => {
    const body: ImportResult = await this.service.commit(importFileOf(req), contextOf(req))
    res.status(body.products > 0 || body.openingStocks > 0 ? 201 : 200).json(body)
  }
}
