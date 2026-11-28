import type { Request, Response } from 'express'
import type { AdminOrder } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import type { IOrderQuery } from '../order/index.ts'
import { ManualRefundDto, RetryRefundDto, SettleRefundDto } from './dto/index.ts'
import type { RefundService } from './refund.service.ts'

/** Each action returns the order detail for the admin page to swap in. */
export class RefundController {
  constructor(
    private readonly service: RefundService,
    private readonly orders: Pick<IOrderQuery, 'loadAdminOrder'>,
  ) {}

  private async respond(res: Response, code: number) {
    const body: AdminOrder = await this.orders.loadAdminOrder(String(code))
    res.json(body)
  }

  manual = async (req: Request, res: Response) => {
    const input = parse(ManualRefundDto, req.body)
    await this.respond(res, await this.service.manual(String(req.params.id), input, contextOf(req)))
  }

  viaGateway = async (req: Request, res: Response) => {
    await this.respond(res, await this.service.viaGateway(String(req.params.id), contextOf(req), req.log))
  }

  settle = async (req: Request, res: Response) => {
    const input = parse(SettleRefundDto, req.body)
    await this.respond(res, await this.service.settle(String(req.params.id), input, contextOf(req)))
  }

  retry = async (req: Request, res: Response) => {
    const input = parse(RetryRefundDto, req.body)
    await this.respond(res, await this.service.retry(String(req.params.id), input, contextOf(req)))
  }
}
