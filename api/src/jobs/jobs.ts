import { PgBoss, fromPrisma } from 'pg-boss'
import type { Logger } from 'pino'
import type { Mail, Mailer } from '../adapters/mailer.ts'
import type { DbClient } from '../db.ts'

const SEND_EMAIL = 'send-email'

/** Xếp thư vào hàng đợi; route chỉ cần phần này của `Jobs`. */
export interface EmailQueue {
  /** Ghi job bằng `db`; gọi trong transaction thì thư chỉ được gửi khi transaction commit. */
  sendEmail(db: DbClient, mail: Mail): Promise<void>
}

/** Hàng đợi job nền trên Postgres (pg-boss); worker gửi email qua `mailer`. */
export class Jobs implements EmailQueue {
  readonly #boss: PgBoss
  readonly #mailer: Mailer

  constructor(options: { databaseUrl: string; mailer: Mailer; logger: Logger; maxConnections?: number }) {
    this.#mailer = options.mailer
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
  }

  async sendEmail(db: DbClient, mail: Mail) {
    await this.#boss.send(SEND_EMAIL, mail, { db: fromPrisma(db) })
  }

  stop() {
    return this.#boss.stop({ graceful: true, timeout: 5_000 })
  }
}
