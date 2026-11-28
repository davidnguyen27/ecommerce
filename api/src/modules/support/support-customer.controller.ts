import type { Request, Response } from 'express'
import type { ExchangeOptions, PublicSupportList, PublicSupportRequest } from '@ecommerce/shared'
import { parse } from '../../core/middleware/validation.ts'
import { CreateSupportDto, SupportMessageDto } from './dto/index.ts'
import type { SupportCustomerService, SupportViewer } from './support-customer.service.ts'

/** Customer support handlers, for one kind of viewer (`viewerOf` reads it from the request). Nothing is cached. */
export class SupportCustomerController {
  constructor(
    private readonly service: SupportCustomerService,
    private readonly viewerOf: (req: Request) => SupportViewer,
  ) {}

  list = async (req: Request, res: Response) => {
    const body: PublicSupportList = await this.service.list(this.viewerOf(req))
    res.set('Cache-Control', 'no-store').json(body)
  }

  create = async (req: Request, res: Response) => {
    const input = parse(CreateSupportDto, req.body)
    const body: PublicSupportRequest = await this.service.create(this.viewerOf(req), input, String(req.ip))
    res.status(201).set('Cache-Control', 'no-store').json(body)
  }

  exchangeOptions = async (req: Request, res: Response) => {
    const orderCode =
      typeof req.query.orderCode === 'string' && /^\d{1,9}$/.test(req.query.orderCode)
        ? Number(req.query.orderCode)
        : undefined
    const body: ExchangeOptions = await this.service.exchangeOptions(this.viewerOf(req), orderCode)
    res.set('Cache-Control', 'no-store').json(body)
  }

  detail = async (req: Request, res: Response) => {
    const body: PublicSupportRequest = await this.service.detail(this.viewerOf(req), String(req.params.requestCode))
    res.set('Cache-Control', 'no-store').json(body)
  }

  addMessage = async (req: Request, res: Response) => {
    const { message } = parse(SupportMessageDto, req.body)
    const code = String(req.params.requestCode)
    const body: PublicSupportRequest = await this.service.addMessage(this.viewerOf(req), code, message)
    res.set('Cache-Control', 'no-store').json(body)
  }

  attach = async (req: Request, res: Response) => {
    const body: PublicSupportRequest = await this.service.attach(
      this.viewerOf(req),
      String(req.params.requestCode),
      String(req.params.messageId),
      req.file,
      String(req.ip),
      req.log,
    )
    res.status(201).set('Cache-Control', 'no-store').json(body)
  }
}
