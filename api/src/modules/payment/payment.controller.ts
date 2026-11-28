import type { Request, Response } from 'express'
import { parse } from '../../core/middleware/validation.ts'
import { SimulatedExpiryDto, SimulatedPaymentDto } from './dto/index.ts'
import type { PaymentService } from './payment.service.ts'

export class PaymentController {
  constructor(
    private readonly service: PaymentService,
    private readonly vnpayHashSecret: string | undefined,
  ) {}

  /** IPN: VNPAY calls the server with GET, params in the query; it reads the result from the JSON body. */
  vnpayIpn = async (req: Request, res: Response) => {
    res.json(
      await this.service.recordVnpayResult(
        this.vnpayHashSecret!,
        req.query as Record<string, unknown>,
        'webhook',
        req.log,
      ),
    )
  }

  /**
   * Return page: VNPAY puts the same signed params on the URL; the result page forwards them to the API. Decided
   * 2026-11-12 since sandbox `querydr` fails and IPN needs a tunnel (ADR 0010). Only VNPAY and we can sign, so it is as
   * safe as IPN; no order token needed.
   */
  vnpayReturn = async (req: Request, res: Response) => {
    const body: unknown = req.body
    const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
    res.json(await this.service.recordVnpayResult(this.vnpayHashSecret!, raw, 'return', req.log))
  }

  simulatePaid = async (req: Request, res: Response) => {
    await this.service.simulatePaid(parse(SimulatedPaymentDto, req.body))
    res.status(204).end()
  }

  simulateExpiry = async (req: Request, res: Response) => {
    const { orderCode } = parse(SimulatedExpiryDto, req.body)
    await this.service.simulateExpiry(orderCode)
    res.status(204).end()
  }
}
