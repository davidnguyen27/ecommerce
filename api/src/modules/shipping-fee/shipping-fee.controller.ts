import type { Request, Response } from 'express'
import type { ShippingFeeConfig } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import { ShippingFeeConfigDto } from './dto/index.ts'
import type { ShippingFeeService } from './shipping-fee.service.ts'

export class ShippingFeeController {
  constructor(private readonly service: ShippingFeeService) {}

  get = async (_req: Request, res: Response) => {
    const body: ShippingFeeConfig = await this.service.get()
    res.json(body)
  }

  update = async (req: Request, res: Response) => {
    const body: ShippingFeeConfig = await this.service.update(parse(ShippingFeeConfigDto, req.body), contextOf(req))
    res.json(body)
  }
}
