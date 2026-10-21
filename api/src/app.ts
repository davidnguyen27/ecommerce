import { randomUUID } from 'node:crypto'
import express from 'express'
import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import type { Mailer } from './adapters/mailer.ts'
import type { Storage } from './adapters/storage.ts'
import { requireAuth } from './auth/require-auth.ts'
import { loadStaff } from './auth/staff-context.ts'
import type { Db } from './db.ts'
import { errorHandler, notFound } from './http/errors.ts'
import { adminRoutes } from './routes/admin.ts'
import { adminAuthRoutes } from './routes/admin-auth.ts'
import { healthRoutes } from './routes/health.ts'

/** Mọi phụ thuộc bên ngoài đi vào app qua đây, để test thay bằng bản giả. */
export type AppDeps = {
  prisma: Db
  logger: Logger
  storage: Storage
  mailer: Mailer
  /** Khóa ký JWT (HS256). */
  jwtSecret: string
}

const REQUEST_ID = /^[\w.-]{1,128}$/

export function createApp(deps: AppDeps) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 'loopback, uniquelocal')

  app.use(
    pinoHttp({
      logger: deps.logger,
      // Mọi dòng log trong một request đều mang `reqId` ở cấp cao nhất.
      quietReqLogger: true,
      genReqId(req, res) {
        const incoming = req.headers['x-request-id']
        const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID()
        res.setHeader('X-Request-Id', id)
        return id
      },
    }),
  )
  app.use(express.json({ limit: '1mb' }))

  app.use(healthRoutes(deps.prisma))

  const secret = new TextEncoder().encode(deps.jwtSecret)
  const api = express.Router()
  api.use('/admin/auth', adminAuthRoutes(deps.prisma, secret, '/api/admin/auth'))
  api.use('/admin', requireAuth(secret, 'staff'), loadStaff(deps.prisma), adminRoutes(deps.prisma))
  app.use('/api', api)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
