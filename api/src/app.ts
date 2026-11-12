import { randomUUID } from 'node:crypto'
import express from 'express'
import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import type { Storage } from './adapters/storage.ts'
import { requireAuth } from './auth/require-auth.ts'
import { loadStaff } from './auth/staff-context.ts'
import type { Db } from './db.ts'
import type { EmailQueue } from './jobs/jobs.ts'
import { errorHandler, notFound } from './http/errors.ts'
import { accountRoutes } from './routes/account.ts'
import { adminRoutes } from './routes/admin.ts'
import { adminAuthRoutes } from './routes/admin-auth.ts'
import { customerAuthRoutes, customerSessions } from './routes/customer-auth.ts'
import { publicLegalInfoRoutes } from './routes/legal-info.ts'
import { publicAttributeSchemaRoutes, publicBrandRoutes, publicCategoryRoutes } from './routes/public-catalog.ts'
import { publicPageRoutes } from './routes/public-pages.ts'
import { publicProductRoutes } from './routes/public-products.ts'
import { publicSitemapRoutes } from './routes/public-sitemap.ts'
import { healthRoutes } from './routes/health.ts'

/** Mọi phụ thuộc bên ngoài đi vào app qua đây, để test thay bằng bản giả. */
export type AppDeps = {
  prisma: Db
  logger: Logger
  storage: Storage
  /** Email đi qua hàng đợi job; worker gửi bằng mailer. */
  emails: EmailQueue
  /** Gốc URL của website, ví dụ `https://shop.vn`, để dựng link trong email. */
  siteUrl: string
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
  api.use('/pages', publicPageRoutes(deps.prisma))
  api.use('/legal-info', publicLegalInfoRoutes(deps.prisma))
  api.use('/brands', publicBrandRoutes(deps.prisma, deps.storage))
  api.use('/products', publicProductRoutes(deps.prisma, deps.storage))
  api.use('/categories', publicCategoryRoutes(deps.prisma))
  api.use('/attribute-schemas', publicAttributeSchemaRoutes(deps.prisma))
  api.use('/sitemap', publicSitemapRoutes(deps.prisma))
  const customerDeps = {
    prisma: deps.prisma,
    emails: deps.emails,
    siteUrl: deps.siteUrl,
    sessions: customerSessions(deps.prisma, secret, '/api/auth'),
  }
  api.use('/auth', customerAuthRoutes(customerDeps))
  api.use('/account', requireAuth(secret, 'customer'), accountRoutes(customerDeps))
  api.use('/admin/auth', adminAuthRoutes(deps.prisma, secret, '/api/admin/auth'))
  api.use('/admin', requireAuth(secret, 'staff'), loadStaff(deps.prisma), adminRoutes(deps.prisma, deps.storage))
  app.use('/api', api)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
