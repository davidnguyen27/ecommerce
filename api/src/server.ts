import pino from 'pino'
import { createApp } from './app.ts'
import { mailerFromEnv } from './adapters/mailer.ts'
import { InMemoryStorage } from './adapters/storage.ts'
import { createPrisma } from './db.ts'
import { Jobs } from './jobs/jobs.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Thiếu biến môi trường DATABASE_URL')
const jwtSecret = process.env.JWT_SECRET
if (!jwtSecret || jwtSecret.length < 32) throw new Error('Thiếu JWT_SECRET hoặc ngắn hơn 32 ký tự')
const siteUrl = process.env.SITE_URL
if (!siteUrl || !URL.canParse(siteUrl)) throw new Error('Thiếu SITE_URL hợp lệ, ví dụ https://shop.vn')
const port = Number(process.env.PORT ?? 3001)

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
})
const prisma = createPrisma(databaseUrl)
const jobs = new Jobs({ databaseUrl, mailer: mailerFromEnv(process.env, logger), logger })
await jobs.start()

// Bản R2 được cắm vào ở ticket media.
const app = createApp({
  prisma,
  logger,
  storage: new InMemoryStorage(),
  emails: jobs,
  siteUrl,
  jwtSecret,
})

const server = app.listen(port, () => logger.info({ port }, 'API đang chạy'))

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => void Promise.all([jobs.stop(), prisma.$disconnect()]).then(() => process.exit(0)))
  })
}
