import { Router } from 'express'
import { ErrorCode, type HealthResponse } from '@ecommerce/shared'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'

export function healthRoutes(prisma: Db) {
  return Router().get('/healthz', async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`
    } catch (err) {
      req.log.error({ err }, 'healthz: không kết nối được DB')
      throw new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, 'Không kết nối được cơ sở dữ liệu')
    }
    const body: HealthResponse = { status: 'ok', db: 'ok' }
    res.json(body)
  })
}
