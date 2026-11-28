import type { Request, Response } from 'express'
import type { CommitmentType as CommitmentTypeBody, CommitmentTypeList } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { BaseCrudController } from '../../core/controller/base-crud.controller.ts'
import { parse } from '../../core/middleware/validation.ts'
import type { CommitmentType } from '../../generated/prisma/client.ts'
import { CommitmentTypeDto, CommitmentTypeParams } from './dto/index.ts'
import { toCommitmentTypeBody } from './commitment-type.mapper.ts'
import type { CommitmentTypeService } from './commitment-type.service.ts'

export class CommitmentTypeController extends BaseCrudController<
  CommitmentType,
  typeof CommitmentTypeDto,
  typeof CommitmentTypeDto,
  CommitmentTypeBody
> {
  constructor(protected override readonly service: CommitmentTypeService) {
    super(service, { create: CommitmentTypeDto, update: CommitmentTypeDto }, toCommitmentTypeBody)
  }

  list = async (_req: Request, res: Response) => {
    const body: CommitmentTypeList = { items: (await this.service.list()).map(this.toBody) }
    res.json(body)
  }

  /** Parses the id before the body, as this route always did. */
  update = async (req: Request, res: Response) => {
    const { id } = parse(CommitmentTypeParams, req.params)
    const input = parse(CommitmentTypeDto, req.body)
    const body: CommitmentTypeBody = this.toBody(await this.service.update(id, input, contextOf(req)))
    res.json(body)
  }
}
