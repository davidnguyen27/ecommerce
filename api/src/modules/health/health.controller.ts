import type { Request, Response } from 'express'
import type { HealthResponse } from '@ecommerce/shared'
import type { HealthService } from './health.service.ts'

export class HealthController {
  constructor(private readonly service: HealthService) {}

  check = async (req: Request, res: Response) => {
    const body: HealthResponse = await this.service.check(req.log)
    res.json(body)
  }
}
