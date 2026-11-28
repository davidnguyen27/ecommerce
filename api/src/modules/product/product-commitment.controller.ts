import type { Request, Response } from 'express'
import type { AdminCommitment, AdminCommitmentList } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import { CommitmentDto, CommitmentParams, ProductParams } from './dto/index.ts'
import type { ProductCommitmentService } from './product-commitment.service.ts'
import { toAdminCommitment } from './product.mapper.ts'

/** Evidenced commitments of a product. URL ids before the body, as always. */
export class ProductCommitmentController {
  constructor(private readonly service: ProductCommitmentService) {}

  list = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    const body: AdminCommitmentList = { items: (await this.service.list(id)).map(toAdminCommitment) }
    res.json(body)
  }

  create = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    const input = parse(CommitmentDto, req.body)
    const body: AdminCommitment = toAdminCommitment(await this.service.create(id, input, contextOf(req)))
    res.status(201).json(body)
  }

  update = async (req: Request, res: Response) => {
    const { id, commitmentId } = parse(CommitmentParams, req.params)
    const input = parse(CommitmentDto, req.body)
    const body: AdminCommitment = toAdminCommitment(await this.service.update(id, commitmentId, input, contextOf(req)))
    res.json(body)
  }

  delete = async (req: Request, res: Response) => {
    const { id, commitmentId } = parse(CommitmentParams, req.params)
    await this.service.delete(id, commitmentId, contextOf(req))
    res.status(204).end()
  }
}
