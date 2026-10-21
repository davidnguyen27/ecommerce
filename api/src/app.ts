import { randomUUID } from 'node:crypto'
import express, { type Router } from 'express'
import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import type { Mailer } from './adapters/mailer.ts'
import type { Storage } from './adapters/storage.ts'
import type { Db } from './db.ts'
import { errorHandler, notFound } from './http/errors.ts'
import { healthRoutes } from './routes/health.ts'

/** Mọi phụ thuộc bên ngoài đi vào app qua đây, để test thay bằng bản giả. */
export type AppDeps = {
  prisma: Db
  logger: Logger
  storage: Storage
  mailer: Mailer
}

const REQUEST_ID = /^[\w.-]{1,128}$/

// TODO: `extraRoutes` hiện chỉ để test gắn endpoint thử cho lỗi kiểm tra dữ liệu.
// Khi có endpoint thật nhận dữ liệu vào (đăng nhập/đăng ký), chuyển test sang đó và bỏ tham số này.
export function createApp(deps: AppDeps, extraRoutes?: Router) {
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

  const api = express.Router()
  if (extraRoutes) api.use(extraRoutes)
  app.use('/api', api)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
