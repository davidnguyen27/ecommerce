import type { Mail } from '../adapters/mailer.ts'
import type { DbClient } from '../db.ts'

// The parts of the job queue that modules use; the worker (`src/jobs/worker.ts`) implements them.

/** Customer emails: the mail queue and the website URL for order lookup links. */
export type CustomerMail = { emails: EmailQueue; siteUrl: string }

/** Queues an email. */
export interface EmailQueue {
  /** Writes the job with `db`; inside a transaction the email is only sent on commit. */
  sendEmail(db: DbClient, mail: Mail): Promise<void>
}

/** Schedules the expiry job for a new order; checkout only needs this part of the queue. */
export interface OrderExpiryQueue {
  /** Writes the job with `db` (the checkout transaction): a rollback leaves no job. */
  scheduleOrderExpiry(db: DbClient, orderId: string, at: Date): Promise<void>
}
