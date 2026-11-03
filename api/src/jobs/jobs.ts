import { PgBoss, fromPrisma } from 'pg-boss'
import type { Logger } from 'pino'
import type { Mail, Mailer } from '../adapters/mailer.ts'
import type { Db, DbClient } from '../db.ts'
import { expireOrder, expireOverdueOrders } from '../orders/cancel-order.ts'
import type { PaymentGateway } from '../payments/gateway.ts'
import { deleteExpiredRecords } from './cleanup.ts'

const SEND_EMAIL = 'send-email'
const DELETE_EXPIRED = 'delete-expired'
const EXPIRE_ORDER = 'expire-order'
const EXPIRE_OVERDUE_ORDERS = 'expire-overdue-orders'

/** Xếp thư vào hàng đợi; route chỉ cần phần này của `Jobs`. */
export interface EmailQueue {
  /** Ghi job bằng `db`; gọi trong transaction thì thư chỉ được gửi khi transaction commit. */
  sendEmail(db: DbClient, mail: Mail): Promise<void>
}

/** Hẹn job hết hạn cho đơn vừa đặt; route đặt mua chỉ cần phần này của `Jobs`. */
export interface OrderExpiryQueue {
  /** Ghi job bằng `db` (transaction đặt mua): đơn rollback thì không còn job. */
  scheduleOrderExpiry(db: DbClient, orderId: string, at: Date): Promise<void>
}

/**
 * Hàng đợi job nền trên Postgres (pg-boss); worker gửi email qua `mailer`, hủy đơn hết hạn giữ hàng (hủy link qua
 * `payments`) và dọn token hết hạn mỗi đêm.
 */
export class Jobs implements EmailQueue, OrderExpiryQueue {
  readonly #boss: PgBoss
  readonly #mailer: Mailer
  readonly #prisma: Db
  readonly #logger: Logger
  readonly #payments: PaymentGateway

  constructor(options: {
    databaseUrl: string
    prisma: Db
    mailer: Mailer
    logger: Logger
    payments: PaymentGateway
    maxConnections?: number
  }) {
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

  /** Tạo schema pg-boss nếu chưa có và bắt đầu nhận job. */
  async start() {
    await this.#boss.start()
    // Nhà cung cấp email lỗi tạm thời thì thử lại, giãn dần.
    await this.#boss.createQueue(SEND_EMAIL, { notify: true, retryLimit: 5, retryDelay: 30, retryBackoff: true })
    await this.#boss.work<Mail>(SEND_EMAIL, async ([job]) => {
      if (job) await this.#mailer.send(job.data)
    })
    await this.#boss.createQueue(DELETE_EXPIRED)
    // Lịch lưu trong DB nên nhiều instance API cùng gọi `schedule` vẫn chỉ chạy một job mỗi lần.
    await this.#boss.schedule(DELETE_EXPIRED, '0 3 * * *', null, { tz: 'Asia/Ho_Chi_Minh' })
    await this.#boss.work(DELETE_EXPIRED, async () => {
      const deleted = await deleteExpiredRecords(this.#prisma)
      this.#logger.info({ deleted }, 'Đã dọn token và bộ đếm hết hạn')
    })

    const cancelDeps = { prisma: this.#prisma, payments: this.#payments, logger: this.#logger }
    await this.#boss.createQueue(EXPIRE_ORDER, { notify: true })
    await this.#boss.work<{ orderId: string }>(EXPIRE_ORDER, async ([job]) => {
      if (job) await expireOrder(cancelDeps, job.data.orderId)
    })
    // Lưới an toàn khi job của từng đơn bị mất hay chạy sớm: quét đơn quá hạn mỗi phút.
    await this.#boss.createQueue(EXPIRE_OVERDUE_ORDERS)
    await this.#boss.schedule(EXPIRE_OVERDUE_ORDERS, '* * * * *')
    await this.#boss.work(EXPIRE_OVERDUE_ORDERS, async () => {
      const expired = await expireOverdueOrders(cancelDeps)
      if (expired > 0) this.#logger.info({ expired }, 'Đã hủy đơn hết hạn giữ hàng')
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
