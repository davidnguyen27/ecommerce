import type { Request, Response } from 'express'
import type { AuditActors, AuditPage } from '@ecommerce/shared'
import { parse } from '../../core/middleware/validation.ts'
import type { AuditLogService } from './audit-log.service.ts'
import { AuditQueryDto } from './dto/index.ts'

export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  list = async (req: Request, res: Response) => {
    const body: AuditPage = await this.service.list(parse(AuditQueryDto, req.query))
    res.json(body)
  }

  actors = async (_req: Request, res: Response) => {
    const body: AuditActors = await this.service.actors()
    res.json(body)
  }
}
