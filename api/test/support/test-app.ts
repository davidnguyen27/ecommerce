import { randomBytes, randomUUID } from 'node:crypto'
import { Writable } from 'node:stream'
import pino from 'pino'
import supertest from 'supertest'
import { inject, onTestFinished } from 'vitest'
import { createApp } from '../../src/app.ts'
import { createPrisma } from '../../src/core/db.ts'
import type { LlmClient } from '../../src/core/adapters/llm.ts'
import { InMemoryMailer } from '../../src/core/adapters/mailer.ts'
import { InMemoryStorage } from '../../src/core/adapters/storage.ts'
import { Jobs } from '../../src/jobs/worker.ts'
import {
  InMemoryPaymentGateway,
  SimulatorPaymentGateway,
  type PaymentGateway,
} from '../../src/core/adapters/payment/gateway.ts'

/** Website base URL in links of emails sent from tests. */
export const SITE_URL = 'https://shop.test'

/** The test `vnp_HashSecret` (not a real or sandbox key); tests sign IPNs with it. */
export const VNPAY_HASH_SECRET = 'test-vnpay-hash-secret'

type Options = {
  /** Overrides the DB URL, e.g. to simulate a lost connection. */
  databaseUrl?: string
  /** Use the simulator as when running locally instead of the in-memory one (`payments` is then unused by the app). */
  simulator?: boolean
  /** Another payment gateway for the app, e.g. VNPAY over fake HTTP (`payments` is then unused by the app). */
  gateway?: PaymentGateway
  /** `trust proxy` like the deploy's `TRUST_PROXY` (ADR 0011); unset keeps the app default. */
  trustProxy?: string | number
  /** The chatbot model, usually `ScriptedLlm`; unset means the server has no key. */
  llm?: LlmClient
}

/**
 * Builds the in-process app on a clean DB cloned from the template. Storage and mailer are in-memory fakes; JSON logs
 * are kept for reading.
 */
export async function createTestApp(options: Options = {}) {
  const databaseUrl = options.databaseUrl ?? (await createCleanDatabase())
  // Small pool: test files run in parallel on one container, one app per test.
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
  // A real job queue on the test DB; the worker sends mail to the fake mailer.
  // An overridden DB is a deliberately broken one, so no worker starts on it.
  const payments = new InMemoryPaymentGateway()
  const gateway = options.gateway ?? (options.simulator ? new SimulatorPaymentGateway(SITE_URL) : payments)
  const jobs = new Jobs({
    databaseUrl,
    prisma,
    mailer,
    logger,
    payments: gateway,
    siteUrl: SITE_URL,
    maxConnections: 2,
  })
  const startJobs = !options.databaseUrl
  if (startJobs) await jobs.start()
  const app = createApp({
    prisma,
    logger,
    emails: jobs,
    orderExpiry: jobs,
    storage,
    jwtSecret,
    siteUrl: SITE_URL,
    payments: gateway,
    vnpayHashSecret: VNPAY_HASH_SECRET,
    trustProxy: options.trustProxy,
    llm: options.llm,
  })

  onTestFinished(async () => {
    if (startJobs) await jobs.stop()
    await prisma.$disconnect()
  })

  return {
    request: supertest(app),
    /** Only for setting up initial data; behavior is checked over HTTP. */
    prisma,
    /** Lets tests sign tokens with the wrong audience or already expired. */
    jwtSecret,
    mailer,
    storage,
    /** The fake payment gateway: created and cancelled links, query status, link creation errors. */
    payments,
    /** The app logger, for tests calling job functions directly. */
    logger,
    /** Dependencies of the expiry function, for tests calling the job with a future `now`. */
    expireDeps: { prisma, payments: gateway, logger, emails: jobs, siteUrl: SITE_URL },
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
