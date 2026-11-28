import type { Request, Response } from 'express'
import type {
  CancelUnsuppliedResult,
  PreorderAttention,
  PreorderCampaign,
  PreorderCampaignPage,
  UnsuppliedPreview,
} from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import {
  CampaignParams,
  CancelUnsuppliedDto,
  PreorderCampaignCreateDto,
  PreorderCampaignQueryDto,
  PreorderCampaignUpdateDto,
} from './dto/index.ts'
import type { PreorderCampaignService } from './preorder-campaign.service.ts'

/** URL ids before the body, as these routes always did. */
export class PreorderCampaignController {
  constructor(private readonly service: PreorderCampaignService) {}

  list = async (req: Request, res: Response) => {
    const query = parse(PreorderCampaignQueryDto, req.query)
    const { items, total } = await this.service.list(query)
    const body: PreorderCampaignPage = { items, total, page: query.page, pageSize: query.pageSize }
    res.json(body)
  }

  attention = async (_req: Request, res: Response) => {
    const body: PreorderAttention = await this.service.attention()
    res.json(body)
  }

  detail = async (req: Request, res: Response) => {
    const { id } = parse(CampaignParams, req.params)
    const body: PreorderCampaign = await this.service.get(id)
    res.json(body)
  }

  open = async (req: Request, res: Response) => {
    const id = await this.service.open(parse(PreorderCampaignCreateDto, req.body), contextOf(req))
    const body: PreorderCampaign = await this.service.get(id)
    res.status(201).json(body)
  }

  update = async (req: Request, res: Response) => {
    const { id } = parse(CampaignParams, req.params)
    await this.service.update(id, parse(PreorderCampaignUpdateDto, req.body), contextOf(req))
    const body: PreorderCampaign = await this.service.get(id)
    res.json(body)
  }

  close = async (req: Request, res: Response) => {
    const { id } = parse(CampaignParams, req.params)
    await this.service.close(id, contextOf(req))
    const body: PreorderCampaign = await this.service.get(id)
    res.json(body)
  }

  unsuppliedPreview = async (req: Request, res: Response) => {
    const { id } = parse(CampaignParams, req.params)
    const body: UnsuppliedPreview = await this.service.previewUnsupplied(id)
    res.json(body)
  }

  cancelUnsupplied = async (req: Request, res: Response) => {
    const { id } = parse(CampaignParams, req.params)
    const { note } = parse(CancelUnsuppliedDto, req.body)
    const cancelledOrderCodes = await this.service.cancelUnsupplied(id, note, contextOf(req))
    const body: CancelUnsuppliedResult = { cancelledOrderCodes, campaign: await this.service.get(id) }
    res.json(body)
  }
}
