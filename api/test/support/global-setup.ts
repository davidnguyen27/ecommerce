import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import pino from 'pino'
import type { TestProject } from 'vitest/node'
import { InMemoryMailer } from '../../src/core/adapters/mailer.ts'
import { createPrisma } from '../../src/core/db.ts'
import { Jobs } from '../../src/core/jobs/jobs.ts'
import { InMemoryPaymentGateway } from '../../src/payments/gateway.ts'

const TEMPLATE_DB = 'app_template'

declare module 'vitest' {
  export interface ProvidedContext {
    /** URL of the template DB with migrations applied; each test clones its own DB. */
    templateDatabaseUrl: string
  }
}

/** One Postgres container for the whole run; migrations run once into the template DB. */
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase(TEMPLATE_DB)
    // Disposable DB: skip synchronous disk writes for speed, since each test clones a DB from the template.
    // On Windows, tests occasionally fail with "Connection terminated due to connection timeout": Docker Desktop's port
    // forwarding stalls 10–40 s, not Postgres or our code. Linux CI is the real gate (ticket 15).
    .withCommand(['postgres', '-c', 'fsync=off', '-c', 'synchronous_commit=off', '-c', 'full_page_writes=off'])
    .start()
    .catch((err: Error) => {
      // Print before throwing: vitest can swallow globalSetup error messages.
      console.error(`Không khởi động được Postgres qua Testcontainers, Docker đã chạy chưa? ${err.message}`)
      throw err
    })
  const url = container.getConnectionUri()

  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js')
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  // Install the pg-boss schema into the template so each test's job queue need not create it again.
  const prisma = createPrisma(url, { maxConnections: 1 })
  const jobs = new Jobs({
    databaseUrl: url,
    prisma,
    mailer: new InMemoryMailer(),
    logger: pino({ enabled: false }),
    payments: new InMemoryPaymentGateway(),
    siteUrl: 'https://shop.test',
  })
  await jobs.start()
  await jobs.stop()
  await prisma.$disconnect()

  project.provide('templateDatabaseUrl', url)
  return async () => {
    await container.stop()
  }
}
