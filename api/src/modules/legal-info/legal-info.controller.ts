import type { Request, Response } from 'express'
import type { LegalInfo } from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import { LegalInfoDto } from './dto/index.ts'
import type { LegalInfoService } from './legal-info.service.ts'

export class LegalInfoController {
  constructor(private readonly service: LegalInfoService) {}

  get = async (_req: Request, res: Response) => {
    const body: LegalInfo = await this.service.get()
    res.json(body)
  }

  save = async (req: Request, res: Response) => {
    const body: LegalInfo = await this.service.save(parse(LegalInfoDto, req.body), contextOf(req))
    res.json(body)
  }
}
