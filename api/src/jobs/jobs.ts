import { PgBoss, fromPrisma } from 'pg-boss'
import type { Logger } from 'pino'
import type { Mail, Mailer } from '../adapters/mailer.ts'
import type { Db, DbClient } from '../db.ts'
import { expireOrder, expireOverdueOrders } from '../orders/cancel-order.ts'
import type { PaymentGateway } from '../payments/gateway.ts'
import { processRemainderDeadlines } from '../preorders/deadlines.ts'
import { flagOverdueExchanges } from '../support/exchanges.ts'
import { deleteExpiredRecords } from './cleanup.ts'

const SEND_EMAIL = 'send-email'
const DELETE_EXPIRED = 'delete-expired'
const EXPIRE_ORDER = 'expire-order'
const EXPIRE_OVERDUE_ORDERS = 'expire-overdue-orders'
const REMAINDER_DEADLINES = 'remainder-deadlines'
const OVERDUE_EXCHANGES = 'overdue-exchanges'

/** Queues an email; routes only need this part of `Jobs`. */
/** Customer emails: the mail queue and the website URL for order lookup links. */
export type CustomerMail = { emails: EmailQueue; siteUrl: string }

export interface EmailQueue {
  /** Writes the job with `db`; inside a transaction the email is only sent on commit. */
  sendEmail(db: DbClient, mail: Mail): Promise<void>
}

/** Schedules the expiry job for a new order; checkout only needs this part of `Jobs`. */
export interface OrderExpiryQueue {
  /** Writes the job with `db` (the checkout transaction): a rollback leaves no job. */
  scheduleOrderExpiry(db: DbClient, orderId: string, at: Date): Promise<void>
}

/**
 * Background job queue on Postgres (pg-boss); the worker sends email via `mailer`, cancels orders whose reservation
 * expired (asking `payments` first) and cleans expired tokens nightly.
 */
export class Jobs implements EmailQueue, OrderExpiryQueue {
  readonly #boss: PgBoss
  readonly #mailer: Mailer
  readonly #prisma: Db
  readonly #logger: Logger
  readonly #payments: PaymentGateway
  readonly #siteUrl: string

  constructor(options: {
    databaseUrl: string
    prisma: Db
    mailer: Mailer
    logger: Logger
    payments: PaymentGateway
    /** Website base URL, for email links when the expiry job records a late payment. */
    siteUrl: string
    maxConnections?: number
  }) {
    this.#siteUrl = options.siteUrl
    this.#mailer = options.mailer
    this.#prisma = options.prisma
    this.#payments = options.payments
    this.#logger = options.logger
    this.#boss = new PgBoss({
      connectionString: options.databaseUrl,
      useListenNotify: true,
      max: options.maxConnections,
    })
    this.#boss.on('error', (err) => options.logger.error({ err }, 'Lỗi hàng đợi job'))
  }

  /** Creates the pg-boss schema if missing and starts taking jobs. */
  async start() {
    await this.#boss.start()
    // Retry transient email provider errors with backoff.
    await this.#boss.createQueue(SEND_EMAIL, { notify: true, retryLimit: 5, retryDelay: 30, retryBackoff: true })
    // Many emails queued in one transaction (a receipt completing several orders, a campaign delivery change) produce
    // one NOTIFY: Postgres merges identical NOTIFYs per transaction. The worker takes one email at a time (only a
    // failing one retries), so the rest wait for polling: lowered from the 30 s default to 2 s.
    await this.#boss.work<Mail>(SEND_EMAIL, { notifyPollingIntervalSeconds: 2 }, async ([job]) => {
      if (job) await this.#mailer.send(job.data)
    })
    await this.#boss.createQueue(DELETE_EXPIRED)
    // Schedules live in the DB, so several API instances calling `schedule` still run one job at a time.
    await this.#boss.schedule(DELETE_EXPIRED, '0 3 * * *', null, { tz: 'Asia/Ho_Chi_Minh' })
    await this.#boss.work(DELETE_EXPIRED, async () => {
      const deleted = await deleteExpiredRecords(this.#prisma)
      this.#logger.info({ deleted }, 'Đã dọn token và bộ đếm hết hạn')
    })

    const expireDeps = {
      prisma: this.#prisma,
      payments: this.#payments,
      logger: this.#logger,
      emails: this,
      siteUrl: this.#siteUrl,
    }
    await this.#boss.createQueue(EXPIRE_ORDER, { notify: true })
    await this.#boss.work<{ orderId: string }>(EXPIRE_ORDER, async ([job]) => {
      if (job) await expireOrder(expireDeps, job.data.orderId, new Date())
    })
    // Safety net when a per-order job is lost or runs early: sweep overdue orders every minute.
    await this.#boss.createQueue(EXPIRE_OVERDUE_ORDERS)
    await this.#boss.schedule(EXPIRE_OVERDUE_ORDERS, '* * * * *')
    await this.#boss.work(EXPIRE_OVERDUE_ORDERS, async () => {
      const expired = await expireOverdueOrders(expireDeps)
      if (expired > 0) this.#logger.info({ expired }, 'Đã hủy đơn hết hạn giữ hàng')
    })
    // Arrived pre-orders: remind before the remaining-balance deadline and flag overdue ones, hourly.
    await this.#boss.createQueue(REMAINDER_DEADLINES)
    await this.#boss.schedule(REMAINDER_DEADLINES, '0 * * * *')
    await this.#boss.work(REMAINDER_DEADLINES, async () => {
      const result = await processRemainderDeadlines(expireDeps)
      if (result.reminded > 0 || result.flagged > 0) this.#logger.info(result, 'Đã xử lý hạn trả phần còn lại')
    })
    // Accepted exchanges with the old item not received after 7 days: flag for staff, every morning (spec M6b).
    await this.#boss.createQueue(OVERDUE_EXCHANGES)
    await this.#boss.schedule(OVERDUE_EXCHANGES, '0 7 * * *', null, { tz: 'Asia/Ho_Chi_Minh' })
    await this.#boss.work(OVERDUE_EXCHANGES, async () => {
      const flagged = await flagOverdueExchanges(this.#prisma)
      if (flagged > 0) this.#logger.info({ flagged }, 'Đã gắn cờ yêu cầu đổi quá hạn gửi hàng')
    })
  }

  async scheduleOrderExpiry(db: DbClient, orderId: string, at: Date) {
    await this.#boss.send(EXPIRE_ORDER, { orderId }, { db: fromPrisma(db), startAfter: at })
  }

  async sendEmail(db: DbClient, mail: Mail) {
    await this.#boss.send(SEND_EMAIL, mail, { db: fromPrisma(db) })
  }

  stop() {
    return this.#boss.stop({ graceful: true, timeout: 5_000 })
  }
}
