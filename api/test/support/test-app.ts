import { randomBytes, randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import pino from 'pino'
import supertest from 'supertest'
import { inject, onTestFinished } from 'vitest'
import { createApp } from '../../src/app.ts'
import { createPrisma } from '../../src/db.ts'
import { InMemoryMailer } from '../../src/adapters/mailer.ts'
import { InMemoryStorage } from '../../src/adapters/storage.ts'
import { Jobs } from '../../src/jobs/jobs.ts'
import { InMemoryPaymentGateway } from '../../src/payments/gateway.ts'

/** Gốc URL website trong link của email gửi ra từ test. */
export const SITE_URL = 'https://shop.test'

type Options = {
  /** Ghi đè URL DB, ví dụ để giả lập mất kết nối. */
  databaseUrl?: string
}

/**
 * Dựng app in-process trên một DB sạch clone từ template.
 * Storage và mailer là bản giả trong bộ nhớ; log JSON được giữ lại để đọc.
 */
export async function createTestApp(options: Options = {}) {
  const databaseUrl = options.databaseUrl ?? (await createCleanDatabase())
  // Pool nhỏ: các file test chạy song song trên một container, mỗi test một app.
  const prisma = createPrisma(databaseUrl, { maxConnections: 3 })

  const lines: string[] = []
  const logger = pino(
    new Writable({
      write(chunk, _encoding, callback) {
        lines.push(...String(chunk).split('\n').filter(Boolean))
        callback()
      },
    }),
  )

  const mailer = new InMemoryMailer()
  const storage = new InMemoryStorage()
  const jwtSecret = randomBytes(32).toString('base64url')
  // Hàng đợi job thật trên DB của test; worker gửi thư vào mailer giả.
  // DB bị ghi đè là DB giả lập hỏng, nên không khởi động worker trên đó.
  const jobs = new Jobs({ databaseUrl, prisma, mailer, logger, maxConnections: 2 })
  const startJobs = !options.databaseUrl
  if (startJobs) await jobs.start()
  const payments = new InMemoryPaymentGateway()
  const app = createApp({ prisma, logger, emails: jobs, storage, jwtSecret, siteUrl: SITE_URL, payments })

  onTestFinished(async () => {
    if (startJobs) await jobs.stop()
    await prisma.$disconnect()
  })

  return {
    request: supertest(app),
    /** Chỉ để dựng dữ liệu ban đầu; hành vi thì kiểm tra qua HTTP. */
    prisma,
    /** Để test tự ký token sai audience hoặc đã hết hạn. */
    jwtSecret,
    mailer,
    storage,
    /** Cổng thanh toán giả: link đã tạo, đã hủy, trạng thái truy vấn, lỗi khi tạo link. */
    payments,
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

async function createCleanDatabase(): Promise<string> {
  const template = new URL(inject('templateDatabaseUrl'))
  const templateName = template.pathname.slice(1)
  const name = `test_${randomUUID().replaceAll('-', '')}`

  const admin = new URL(template)
  admin.pathname = '/postgres'
  const prisma = createPrisma(admin.toString(), { maxConnections: 1 })
  try {
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`)
  } finally {
    await prisma.$disconnect()
  }

  const url = new URL(template)
  url.pathname = `/${name}`
  return url.toString()
}
