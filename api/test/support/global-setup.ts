import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import pino from 'pino'
import type { TestProject } from 'vitest/node'
import { InMemoryMailer } from '../../src/adapters/mailer.ts'
import { Jobs } from '../../src/jobs/jobs.ts'

const TEMPLATE_DB = 'app_template'

declare module 'vitest' {
  export interface ProvidedContext {
    /** URL tới DB template đã chạy migration; mỗi test clone ra một DB riêng. */
    templateDatabaseUrl: string
  }
}

/** Một container Postgres cho cả lượt chạy; migration chạy một lần vào DB template. */
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase(TEMPLATE_DB)
    // DB dùng một lần: bỏ ghi đĩa đồng bộ. Mỗi test clone DB từ template, I/O dồn lại làm Postgres khựng vài giây
    // và transaction tương tác của Prisma quá 5s thì hết hạn giữa chừng (500 ngẫu nhiên).
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'])
    .start()
    .catch((err: Error) => {
      // In ra trước khi ném: vitest có thể làm mất thông điệp lỗi của globalSetup.
      console.error(`Không khởi động được Postgres qua Testcontainers, Docker đã chạy chưa? ${err.message}`)
      throw err
    })
  const url = container.getConnectionUri()

  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js')
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  // Cài sẵn schema pg-boss vào template, để mỗi test khởi động hàng đợi job không phải tạo lại.
  const jobs = new Jobs({ databaseUrl: url, mailer: new InMemoryMailer(), logger: pino({ enabled: false }) })
  await jobs.start()
  await jobs.stop()

  project.provide('templateDatabaseUrl', url)
  return async () => {
    await container.stop()
  }
}
