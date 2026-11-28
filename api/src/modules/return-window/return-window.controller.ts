import type { Request, Response } from 'express'
import type { ReturnWindowList } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import { ReturnWindowListDto } from './dto/index.ts'
import type { ReturnWindowService } from './return-window.service.ts'

export class ReturnWindowController {
  constructor(private readonly service: ReturnWindowService) {}

  list = async (_req: Request, res: Response) => {
    const body: ReturnWindowList = { items: await this.service.list() }
    res.json(body)
  }

  save = async (req: Request, res: Response) => {
    const { items } = parse(ReturnWindowListDto, req.body)
    const body: ReturnWindowList = { items: await this.service.save(items, contextOf(req)) }
    res.json(body)
  }
}
