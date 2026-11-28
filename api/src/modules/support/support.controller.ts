import type { Request, Response } from 'express'
import { ErrorCode, type AdminSupportPage, type AdminSupportRequest, type ExchangeOptions } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { AppError } from '../../core/errors.ts'
import { parse } from '../../core/middleware/validation.ts'
import { currentStaff, hasPermission } from '../../core/middleware/staff-context.ts'
import {
  AdminCreateSupportDto,
  AdminSupportQueryDto,
  AdminSupportReplyDto,
  AssignSupportDto,
  DecideSupportDto,
  ProposeReturnRefundDto,
  ReceiveSupportReturnDto,
  RecordWarrantyMilestoneDto,
  RecordWarrantyOutcomeDto,
  ShipExchangeDto,
} from './dto/index.ts'
import type { SupportService } from './support.service.ts'

/** Request code from the URL; a non-code string is 404, like a code with no request. */
const requestCode = (req: Request) => {
  const code = String(req.params.code)
  if (!/^\d{1,9}$/.test(code)) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy yêu cầu')
  return Number(code)
}

/** Admin support requests; every action responds with the request detail. */
export class SupportController {
  constructor(private readonly service: SupportService) {}

  private async respond(req: Request, res: Response, code: number, status = 200) {
    const body: AdminSupportRequest = await this.service.detail(code, hasPermission(req, 'support.handle'))
    res.status(status).json(body)
  }

  list = async (req: Request, res: Response) => {
    const query = parse(AdminSupportQueryDto, req.query)
    const body: AdminSupportPage = await this.service.list(query, currentStaff(req).id)
    res.json(body)
  }

  exchangeOptions = async (req: Request, res: Response) => {
    const orderCode = typeof req.query.orderCode === 'string' ? Number(req.query.orderCode) : NaN
    const body: ExchangeOptions = await this.service.exchangeOptions(orderCode)
    res.json(body)
  }

  detail = async (req: Request, res: Response) => {
    await this.respond(req, res, requestCode(req))
  }

  create = async (req: Request, res: Response) => {
    const code = await this.service.create(parse(AdminCreateSupportDto, req.body), contextOf(req))
    await this.respond(req, res, code, 201)
  }

  reply = async (req: Request, res: Response) => {
    const input = parse(AdminSupportReplyDto, req.body)
    const code = requestCode(req)
    await this.service.reply(code, input, contextOf(req))
    await this.respond(req, res, code)
  }

  claim = async (req: Request, res: Response) => {
    const code = requestCode(req)
    await this.service.claim(code, contextOf(req))
    await this.respond(req, res, code)
  }

  /** Images attach to the staff member's own message (spec M6b ticket 02). */
  attach = async (req: Request, res: Response) => {
    const code = requestCode(req)
    await this.service.attach(code, String(req.params.messageId), req.file, contextOf(req), req.log)
    await this.respond(req, res, code, 201)
  }

  decide = async (req: Request, res: Response) => {
    const input = parse(DecideSupportDto, req.body)
    const code = requestCode(req)
    await this.service.decide(code, input, contextOf(req))
    await this.respond(req, res, code)
  }

  receive = async (req: Request, res: Response) => {
    const input = parse(ReceiveSupportReturnDto, req.body)
    const code = requestCode(req)
    await this.service.receive(code, input, contextOf(req))
    await this.respond(req, res, code)
  }

  shipExchange = async (req: Request, res: Response) => {
    const input = parse(ShipExchangeDto, req.body)
    const code = requestCode(req)
    await this.service.shipExchange(code, input, contextOf(req))
    await this.respond(req, res, code)
  }

  warrantyMilestone = async (req: Request, res: Response) => {
    const input = parse(RecordWarrantyMilestoneDto, req.body)
    const code = requestCode(req)
    await this.service.warrantyMilestone(code, input, contextOf(req))
    await this.respond(req, res, code)
  }

  warrantyOutcome = async (req: Request, res: Response) => {
    const input = parse(RecordWarrantyOutcomeDto, req.body)
    const code = requestCode(req)
    await this.service.warrantyOutcome(code, input, contextOf(req))
    await this.respond(req, res, code)
  }

  refund = async (req: Request, res: Response) => {
    const input = parse(ProposeReturnRefundDto, req.body)
    const code = requestCode(req)
    await this.service.refund(code, input, contextOf(req))
    await this.respond(req, res, code)
  }

  assign = async (req: Request, res: Response) => {
    const { staffId } = parse(AssignSupportDto, req.body)
    const code = requestCode(req)
    await this.service.assign(code, staffId, contextOf(req))
    await this.respond(req, res, code)
  }
}
