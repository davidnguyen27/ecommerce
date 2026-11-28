import type { Request, Response } from 'express'
import type { StockItem, StockMovementPage, StockPage } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import { StockAdjustmentDto, StockMovementQueryDto, StockQueryDto } from './dto/index.ts'
import { toStockItem, toStockMovement } from './stock.mapper.ts'
import type { StockService } from './stock.service.ts'

export class StockController {
  constructor(private readonly service: StockService) {}

  list = async (req: Request, res: Response) => {
    const query = parse(StockQueryDto, req.query)
    const { variants, total } = await this.service.list(query)
    const body: StockPage = { items: variants.map(toStockItem), total, page: query.page, pageSize: query.pageSize }
    res.json(body)
  }

  movements = async (req: Request, res: Response) => {
    const query = parse(StockMovementQueryDto, req.query)
    const { movements, total } = await this.service.movements(query)
    const body: StockMovementPage = {
      items: movements.map(toStockMovement),
      total,
      page: query.page,
      pageSize: query.pageSize,
    }
    res.json(body)
  }

  adjust = async (req: Request, res: Response) => {
    const input = parse(StockAdjustmentDto, req.body)
    const changed = await this.service.adjust(input, contextOf(req))
    const body: StockItem = toStockItem(await this.service.stockItem(input.variantId))
    res.status(changed ? 201 : 200).json(body)
  }
}
