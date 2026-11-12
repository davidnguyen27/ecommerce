import { randomUUID } from 'node:crypto'
import express from 'express'
import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import type { Storage } from './adapters/storage.ts'
import { requireAuth } from './auth/require-auth.ts'
import { loadStaff } from './auth/staff-context.ts'
import type { Db } from './db.ts'
import type { EmailQueue, OrderExpiryQueue } from './jobs/jobs.ts'
import type { PaymentGateway } from './payments/gateway.ts'
import { errorHandler, notFound } from './http/errors.ts'
import { accountOrderRoutes } from './routes/account-orders.ts'
import { accountRoutes } from './routes/account.ts'
import { adminRoutes } from './routes/admin.ts'
import { adminAuthRoutes } from './routes/admin-auth.ts'
import { customerAuthRoutes, customerSessions } from './routes/customer-auth.ts'
import { publicLegalInfoRoutes } from './routes/legal-info.ts'
import { publicAttributeSchemaRoutes, publicBrandRoutes, publicCategoryRoutes } from './routes/public-catalog.ts'
import { publicPageRoutes } from './routes/public-pages.ts'
import { publicProductRoutes } from './routes/public-products.ts'
import { publicSitemapRoutes } from './routes/public-sitemap.ts'
import { checkoutRoutes } from './routes/checkout.ts'
import { publicOrderRoutes } from './routes/public-orders.ts'
import { paymentRoutes } from './routes/payments.ts'
import { healthRoutes } from './routes/health.ts'

/** Mọi phụ thuộc bên ngoài đi vào app qua đây, để test thay bằng bản giả. */
export type AppDeps = {
  prisma: Db
  logger: Logger
  storage: Storage
  /** Email đi qua hàng đợi job; worker gửi bằng mailer. */
  emails: EmailQueue
  /** Job hủy đơn khi hết hạn giữ hàng, xếp lúc đặt mua. */
  orderExpiry: OrderExpiryQueue
  /** Gốc URL của website, ví dụ `https://shop.vn`, để dựng link trong email. */
  siteUrl: string
  /** Khóa ký JWT (HS256). */
  jwtSecret: string
  /** Cổng thanh toán: VNPAY, cổng giả lập khi chạy local, bản trong bộ nhớ khi test. */
  payments: PaymentGateway
  /** `vnp_HashSecret` để kiểm chữ ký IPN; không có thì không mở route IPN. */
  vnpayHashSecret?: string
  /**
   * Giá trị `trust proxy` của Express, để `req.ip` là IP khách (rate limit, audit, `vnp_IpAddr`). Mặc định tin proxy
   * trong mạng riêng (Caddy trên VPS); bản deploy Netlify → Render đặt số tầng proxy (ADR 0011).
   */
  trustProxy?: string | number
}

/** Đọc `TRUST_PROXY`: số là số tầng proxy, chuỗi khác là danh sách địa chỉ/từ khóa của Express, trống là mặc định. */
export function trustProxyFromEnv(value: string | undefined): string | number | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed
}

const REQUEST_ID = /^[\w.-]{1,128}$/

export function createApp(deps: AppDeps) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', deps.trustProxy ?? 'loopback, uniquelocal')

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
  // Mặc định không cho cache: CDN đứng trước API (proxy Netlify, ADR 0011) có thể cache response có ETag, kể cả dữ
  // liệu cá nhân. Route nào muốn cache thì tự đặt lại header.
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  api.use('/pages', publicPageRoutes(deps.prisma))
  api.use('/legal-info', publicLegalInfoRoutes(deps.prisma))
  api.use('/brands', publicBrandRoutes(deps.prisma, deps.storage))
  api.use('/products', publicProductRoutes(deps.prisma, deps.storage))
  api.use('/categories', publicCategoryRoutes(deps.prisma))
  api.use('/attribute-schemas', publicAttributeSchemaRoutes(deps.prisma))
  api.use('/sitemap', publicSitemapRoutes(deps.prisma))
  api.use('/checkout', checkoutRoutes(deps))
  api.use('/orders', publicOrderRoutes(deps))
  api.use('/payments', paymentRoutes(deps))
  const customerDeps = {
    prisma: deps.prisma,
    emails: deps.emails,
    siteUrl: deps.siteUrl,
    sessions: customerSessions(deps.prisma, secret, '/api/auth'),
  }
  api.use('/auth', customerAuthRoutes(customerDeps))
  api.use('/account/orders', requireAuth(secret, 'customer'), accountOrderRoutes(deps))
  api.use('/account', requireAuth(secret, 'customer'), accountRoutes(customerDeps))
  api.use('/admin/auth', adminAuthRoutes(deps.prisma, secret, '/api/admin/auth'))
  api.use(
    '/admin',
    requireAuth(secret, 'staff'),
    loadStaff(deps.prisma),
    adminRoutes(deps.prisma, deps.storage, deps.payments, { emails: deps.emails, siteUrl: deps.siteUrl }),
  )
  app.use('/api', api)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
