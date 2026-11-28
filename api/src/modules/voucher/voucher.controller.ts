import type { Request, Response } from 'express'
import type { Voucher, VoucherOrderPage, VoucherPage } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import {
  VoucherCreateDto,
  VoucherOrdersQueryDto,
  VoucherParams,
  VoucherQueryDto,
  VoucherUpdateDto,
} from './dto/index.ts'
import type { VoucherService } from './voucher.service.ts'

export class VoucherController {
  constructor(private readonly service: VoucherService) {}

  private idOf(req: Request) {
    return parse(VoucherParams, req.params).id
  }

  list = async (req: Request, res: Response) => {
    const body: VoucherPage = await this.service.list(parse(VoucherQueryDto, req.query))
    res.json(body)
  }

  detail = async (req: Request, res: Response) => {
    const body: Voucher = await this.service.get(this.idOf(req))
    res.json(body)
  }

  orders = async (req: Request, res: Response) => {
    const id = this.idOf(req)
    const body: VoucherOrderPage = await this.service.orders(id, parse(VoucherOrdersQueryDto, req.query))
    res.json(body)
  }

  create = async (req: Request, res: Response) => {
    const body: Voucher = await this.service.create(parse(VoucherCreateDto, req.body), contextOf(req))
    res.status(201).json(body)
  }

  update = async (req: Request, res: Response) => {
    const id = this.idOf(req)
    const body: Voucher = await this.service.update(id, parse(VoucherUpdateDto, req.body), contextOf(req))
    res.json(body)
  }

  disable = async (req: Request, res: Response) => {
    const body: Voucher = await this.service.disable(this.idOf(req), contextOf(req))
    res.json(body)
  }
}
