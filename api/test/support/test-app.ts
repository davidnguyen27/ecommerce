import { randomBytes, randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import pino from 'pino'
import supertest from 'supertest'
import { inject, onTestFinished } from 'vitest'
import { createApp } from '../../src/app.ts'
import { createPrisma } from '../../src/db.ts'
import { InMemoryMailer } from '../../src/adapters/mailer.ts'
import { InMemoryStorage } from '../../src/adapters/storage.ts'

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
  const prisma = createPrisma(databaseUrl)

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
  const app = createApp({ prisma, logger, mailer, storage, jwtSecret })

  onTestFinished(() => prisma.$disconnect())

  return {
    request: supertest(app),
    /** Chỉ để dựng dữ liệu ban đầu; hành vi thì kiểm tra qua HTTP. */
    prisma,
    /** Để test tự ký token sai audience hoặc đã hết hạn. */
    jwtSecret,
    mailer,
    storage,
    logs: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

async function createCleanDatabase(): Promise<string> {
  const template = new URL(inject('templateDatabaseUrl'))
  const templateName = template.pathname.slice(1)
  const name = `test_${randomUUID().replaceAll('-', '')}`

  const admin = new URL(template)
  admin.pathname = '/postgres'
  const prisma = createPrisma(admin.toString())
  try {
    await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "${templateName}"`)
  } finally {
    await prisma.$disconnect()
  }

  const url = new URL(template)
  url.pathname = `/${name}`
  return url.toString()
}
