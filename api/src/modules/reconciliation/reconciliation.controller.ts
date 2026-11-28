import type { Request, Response } from 'express'
import type { AdminOrder, ReconciliationPage } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import type { IOrderQuery } from '../order/index.ts'
import { ReconciliationQueryDto, ResolveReconciliationDto } from './dto/index.ts'
import type { ReconciliationService } from './reconciliation.service.ts'

/** Actions return the order detail for the admin page to swap in. */
export class ReconciliationController {
  constructor(
    private readonly service: ReconciliationService,
    private readonly orders: Pick<IOrderQuery, 'loadAdminOrder'>,
  ) {}

  private async respond(res: Response, code: number) {
    const body: AdminOrder = await this.orders.loadAdminOrder(String(code))
    res.json(body)
  }

  list = async (req: Request, res: Response) => {
    const query = parse(ReconciliationQueryDto, req.query)
    const { items, total } = await this.service.list(query)
    const body: ReconciliationPage = { items, total, page: query.page, pageSize: query.pageSize }
    res.json(body)
  }

  restore = async (req: Request, res: Response) => {
    await this.respond(res, await this.service.restore(String(req.params.id), contextOf(req)))
  }

  refund = async (req: Request, res: Response) => {
    await this.respond(res, await this.service.refund(String(req.params.id), contextOf(req)))
  }

  resolve = async (req: Request, res: Response) => {
    const { note } = parse(ResolveReconciliationDto, req.body)
    await this.respond(res, await this.service.resolve(String(req.params.id), note, contextOf(req)))
  }
}
