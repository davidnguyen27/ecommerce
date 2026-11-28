import pino from 'pino'
import { createApp, trustProxyFromEnv } from './app.ts'
import { llmFromEnv } from './core/adapters/llm.ts'
import { mailerFromEnv } from './core/adapters/mailer.ts'
import { storageFromEnv } from './core/adapters/storage.ts'
import { createPrisma } from './core/db.ts'
import { Jobs } from './core/jobs/jobs.ts'
import { paymentGatewayFromEnv, vnpayKeysFromEnv } from './core/adapters/payment/gateway-from-env.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Thiếu biến môi trường DATABASE_URL')
const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret || jwtSecret.length < 32) throw new Error('Thiếu JWT_SECRET hoặc ngắn hơn 32 ký tự')
const siteUrl = process.env.SITE_URL
if (!siteUrl || !URL.canParse(siteUrl)) throw new Error('Thiếu SITE_URL hợp lệ, ví dụ https://shop.vn')
const port = Number(process.env.PORT ?? 3001)
// Check before connecting to the DB: production without VNPAY keys (or with sandbox keys) stops right away.
const payments = paymentGatewayFromEnv(process.env, siteUrl)

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
})
const prisma = createPrisma(databaseUrl)
const jobs = new Jobs({ databaseUrl, prisma, mailer: mailerFromEnv(process.env, logger), logger, payments, siteUrl })
await jobs.start()

const app = createApp({
  prisma,
  logger,
  storage: storageFromEnv(process.env, logger),
  emails: jobs,
  orderExpiry: jobs,
  siteUrl,
  jwtSecret,
  payments,
  // The VNPAY IPN route is only mounted when VNPAY is in use.
  vnpayHashSecret: vnpayKeysFromEnv(process.env)?.hashSecret,
  trustProxy: trustProxyFromEnv(process.env.TRUST_PROXY),
  llm: llmFromEnv(process.env),
})

const server = app.listen(port, () => logger.info({ port, payments: payments.constructor.name }, 'API đang chạy'))

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => void Promise.all([jobs.stop(), prisma.$disconnect()]).then(() => process.exit(0)))
  })
}
