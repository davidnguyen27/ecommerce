import { ErrorCode, type HealthResponse } from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { Db } from '../../core/db.ts'
import { AppError } from '../../core/errors.ts'

/** Liveness for the host's health check: the API answers and reaches the DB. */
export class HealthService {
  constructor(private readonly prisma: Db) {}

  async check(log: Logger): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`
    } catch (err) {
      log.error({ err }, 'healthz: không kết nối được DB')
      throw new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, 'Không kết nối được cơ sở dữ liệu')
    }
    return { status: 'ok', db: 'ok' }
  }
}
