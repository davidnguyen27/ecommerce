import type { Request, Response } from 'express'
import type { CheckoutQuote, CheckoutResult, PreorderQuote } from '@ecommerce/shared'
import { parse } from '../../core/middleware/validation.ts'
import { CheckoutDto, CheckoutQuoteDto, PreorderDto, PreorderQuoteDto } from './dto/index.ts'
import type { CheckoutService } from './checkout.service.ts'
import type { orderPlacement } from './place-order.ts'

/** The customer placing: a signed-in customer (optional) links the order to the account. */
const placerOf = (req: Request) => ({ customerId: req.auth?.subjectId ?? null, clientIp: req.ip, log: req.log })

export class CheckoutController {
  constructor(
    private readonly service: CheckoutService,
    private readonly placement: ReturnType<typeof orderPlacement>,
  ) {}

  quote = async (req: Request, res: Response) => {
    const body: CheckoutQuote = await this.service.quote(parse(CheckoutQuoteDto, req.body), String(req.ip))
    res.json(body)
  }

  checkout = async (req: Request, res: Response) => {
    const input = parse(CheckoutDto, req.body)
    const body: CheckoutResult = await this.placement.checkout(input, placerOf(req))
    res.status(201).json(body)
  }

  preorderQuote = async (req: Request, res: Response) => {
    const body: PreorderQuote = await this.service.preorderQuote(parse(PreorderQuoteDto, req.body), String(req.ip))
    res.json(body)
  }

  preorder = async (req: Request, res: Response) => {
    const input = parse(PreorderDto, req.body)
    const body: CheckoutResult = await this.placement.preorder(input, placerOf(req))
    res.status(201).json(body)
  }
}
