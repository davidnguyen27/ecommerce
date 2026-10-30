import { PgBoss, fromPrisma } from 'pg-boss'
import type { Logger } from 'pino'
import type { Mail, Mailer } from '../adapters/mailer.ts'
import type { Db, DbClient } from '../db.ts'
import { deleteExpiredRecords } from './cleanup.ts'

const SEND_EMAIL = 'send-email'
const DELETE_EXPIRED = 'delete-expired'

/** Xếp thư vào hàng đợi; route chỉ cần phần này của `Jobs`. */
export interface EmailQueue {
  /** Ghi job bằng `db`; gọi trong transaction thì thư chỉ được gửi khi transaction commit. */
  sendEmail(db: DbClient, mail: Mail): Promise<void>
}

/** Hàng đợi job nền trên Postgres (pg-boss); worker gửi email qua `mailer` và dọn token hết hạn mỗi đêm. */
export class Jobs implements EmailQueue {
  readonly #boss: PgBoss
  readonly #mailer: Mailer
  readonly #prisma: Db
  readonly #logger: Logger

  constructor(options: { databaseUrl: string; prisma: Db; mailer: Mailer; logger: Logger; maxConnections?: number }) {
    this.#mailer = options.mailer
    this.#prisma = options.prisma
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
  }

  async sendEmail(db: DbClient, mail: Mail) {
    await this.#boss.send(SEND_EMAIL, mail, { db: fromPrisma(db) })
  }

  stop() {
    return this.#boss.stop({ graceful: true, timeout: 5_000 })
  }
}
