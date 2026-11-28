import { randomUUID } from 'node:crypto'
import express from 'express'
import type { Logger } from 'pino'
import { pinoHttp } from 'pino-http'
import type { LlmClient } from './core/adapters/llm.ts'
import type { Storage } from './core/adapters/storage.ts'
import { requireAuth } from './core/middleware/require-auth.ts'
import { loadStaff } from './core/middleware/staff-context.ts'
import type { Db } from './core/db.ts'
import type { EmailQueue, OrderExpiryQueue } from './core/jobs/jobs.ts'
import type { PaymentGateway } from './payments/gateway.ts'
import { errorHandler, notFound } from './core/errors.ts'
import { accountOrderRoutes } from './routes/account-orders.ts'
import { accountRoutes } from './routes/account.ts'
import { accountSupportRoutes, contactSupportRoutes, orderSupportRoutes } from './routes/support-customer.ts'
import { adminRoutes } from './routes/admin.ts'
import { adminAuthRoutes } from './routes/admin-auth.ts'
import { customerAuthRoutes, customerSessions } from './routes/customer-auth.ts'
import { publicLegalInfoRoutes } from './routes/legal-info.ts'
import { publicAttributeSchemaRoutes, publicBrandRoutes } from './routes/public-catalog.ts'
import { publicPageRoutes } from './routes/public-pages.ts'
import { publicProductRoutes } from './routes/public-products.ts'
import { publicSitemapRoutes } from './routes/public-sitemap.ts'
import { chatRoutes } from './routes/chat.ts'
import { checkoutRoutes } from './routes/checkout.ts'
import { preorderRoutes } from './routes/preorders.ts'
import { publicOrderRoutes } from './routes/public-orders.ts'
import { paymentRoutes } from './routes/payments.ts'
import { healthRoutes } from './routes/health.ts'
import { createModules } from './modules/index.ts'

/** Every external dependency enters the app here, so tests can swap in fakes. */
export type AppDeps = {
  prisma: Db
  logger: Logger
  storage: Storage
  /** Email goes through the job queue; the worker sends it with the mailer. */
  emails: EmailQueue
  /** Job that cancels an order when its reservation expires, queued at checkout. */
  orderExpiry: OrderExpiryQueue
  /** Website base URL, e.g. `https://shop.vn`, for links in emails. */
  siteUrl: string
  /** JWT signing key (HS256). */
  jwtSecret: string
  /** Payment gateway: VNPAY, the simulator locally, in-memory in tests. */
  payments: PaymentGateway
  /** `vnp_HashSecret` for IPN signatures; without it the IPN route is not mounted. */
  vnpayHashSecret?: string
  /**
   * Express `trust proxy`, so `req.ip` is the client IP (rate limits, audit, `vnp_IpAddr`). Defaults to trusting
   * private-network proxies (Caddy on a VPS); the Netlify → Render deploy sets a hop count (ADR 0011).
   */
  trustProxy?: string | number
  /** Chatbot model (ADR 0017); absent when no key is set, so the chatbot does not answer. */
  llm?: LlmClient
}

/** Reads `TRUST_PROXY`: a number is a hop count, other text an Express address/keyword list, empty the default. */
export function trustProxyFromEnv(value: string | undefined): string | number | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed
}

const REQUEST_ID = /^[\w.-]{1,128}$/

/** Hides `token` query values (order and support lookup links grant access) from logged URLs. */
export function redactTokens(url: string) {
  return url.replace(/([?&]token=)[^&#]*/g, '$1[redacted]')
}

export function createApp(deps: AppDeps) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', deps.trustProxy ?? 'loopback, uniquelocal')

  app.use(
    pinoHttp({
      logger: deps.logger,
      // Every log line in a request carries `reqId` at the top level.
      quietReqLogger: true,
      serializers: {
        // Receives pino-http's serialized request; its `query` may be the live object, so it is replaced, not mutated.
        req(req: { url?: string; query?: Record<string, unknown> }) {
          if (req.url) req.url = redactTokens(req.url)
          if (req.query && 'token' in req.query) req.query = { ...req.query, token: '[redacted]' }
          return req
        },
      },
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
  // No caching by default: a CDN in front of the API (Netlify proxy, ADR 0011) may cache ETag responses, even personal
  // data. Routes that want caching set the header themselves.
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  // Modules first, in `createModules` order; the old routers below still serve paths not moved yet.
  const signIn = {
    public: [],
    customer: [requireAuth(secret, 'customer')],
    staff: [requireAuth(secret, 'staff'), loadStaff(deps.prisma)],
  }
  for (const module of createModules(deps)) {
    for (const route of module.routes) {
      api.use(route.access === 'staff' ? `/admin${route.path}` : route.path, ...signIn[route.access], route.router)
    }
  }
  api.use('/pages', publicPageRoutes(deps.prisma))
  api.use('/legal-info', publicLegalInfoRoutes(deps.prisma))
  api.use('/brands', publicBrandRoutes(deps.prisma, deps.storage))
  api.use('/products', publicProductRoutes(deps.prisma, deps.storage))
  api.use('/attribute-schemas', publicAttributeSchemaRoutes(deps.prisma))
  api.use('/sitemap', publicSitemapRoutes(deps.prisma))
  api.use('/checkout', checkoutRoutes(deps))
  api.use('/preorders', preorderRoutes(deps))
  api.use('/orders/:code/support-requests', orderSupportRoutes(deps))
  api.use('/orders', publicOrderRoutes(deps))
  api.use('/payments', paymentRoutes(deps))
  api.use('/chat', chatRoutes({ ...deps, secret }))
  api.use('/support-requests', contactSupportRoutes(deps))
  const customerDeps = {
    prisma: deps.prisma,
    emails: deps.emails,
    siteUrl: deps.siteUrl,
    sessions: customerSessions(deps.prisma, secret, '/api/auth'),
  }
  api.use('/auth', customerAuthRoutes(customerDeps))
  api.use('/account/orders', requireAuth(secret, 'customer'), accountOrderRoutes(deps))
  api.use('/account/support-requests', requireAuth(secret, 'customer'), accountSupportRoutes(deps))
  api.use('/account', requireAuth(secret, 'customer'), accountRoutes(customerDeps))
  api.use('/admin/auth', adminAuthRoutes(deps.prisma, secret, '/api/admin/auth'))
  api.use('/admin', requireAuth(secret, 'staff'), loadStaff(deps.prisma), adminRoutes(deps))
  app.use('/api', api)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
