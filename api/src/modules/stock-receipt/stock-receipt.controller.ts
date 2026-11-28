import type { Request, Response } from 'express'
import type { StockReceipt, StockReceiptPage, StockReceiptPreview } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import { ReceiptParams, StockReceiptDto, StockReceiptPreviewDto, StockReceiptQueryDto } from './dto/index.ts'
import { toReceipt, toReceiptSummary } from './stock-receipt.mapper.ts'
import type { StockReceiptService } from './stock-receipt.service.ts'

export class StockReceiptController {
  constructor(private readonly service: StockReceiptService) {}

  list = async (req: Request, res: Response) => {
    const query = parse(StockReceiptQueryDto, req.query)
    const { receipts, total } = await this.service.list(query)
    const body: StockReceiptPage = {
      items: receipts.map(toReceiptSummary),
      total,
      page: query.page,
      pageSize: query.pageSize,
    }
    res.json(body)
  }

  preview = async (req: Request, res: Response) => {
    const body: StockReceiptPreview = await this.service.preview(parse(StockReceiptPreviewDto, req.body))
    res.json(body)
  }

  detail = async (req: Request, res: Response) => {
    const { id } = parse(ReceiptParams, req.params)
    const body: StockReceipt = toReceipt(await this.service.get(id))
    res.json(body)
  }

  create = async (req: Request, res: Response) => {
    const id = await this.service.create(parse(StockReceiptDto, req.body), contextOf(req))
    const body: StockReceipt = toReceipt(await this.service.get(id))
    res.status(201).json(body)
  }
}
