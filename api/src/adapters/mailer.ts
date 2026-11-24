import type { Logger } from 'pino'

export type Mail = {
  to: string
  subject: string
  text: string
  html?: string
}

/** Sends email. Production uses a transactional provider; tests read from the in-memory one. */
export interface Mailer {
  send(mail: Mail): Promise<void>
}

export class InMemoryMailer implements Mailer {
  readonly sent: Mail[] = []

  async send(mail: Mail) {
    this.sent.push(mail)
  }
}

/** Local only: logs mail instead of sending, so verification links can be opened during development. */
export class LogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async send(mail: Mail) {
    this.logger.info({ mail }, 'Email (không gửi thật)')
  }
}

/** Sends via the Resend API (https://resend.com/docs/api-reference/emails/send-email). */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(mail: Mail) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      signal: AbortSignal.timeout(15_000),
    })
    // Throw so the email job is retried.
    if (!res.ok) throw new Error(`Resend trả ${res.status}: ${await res.text()}`)
  }
}

/** Picks the mailer from `MAIL_PROVIDER`: `resend` (needs `RESEND_API_KEY`, `MAIL_FROM`) or `log` for local. */
export function mailerFromEnv(env: NodeJS.ProcessEnv, logger: Logger): Mailer {
  switch (env.MAIL_PROVIDER) {
    case 'resend': {
      const { RESEND_API_KEY: apiKey, MAIL_FROM: from } = env
      if (!apiKey || !from) throw new Error('MAIL_PROVIDER=resend cần RESEND_API_KEY và MAIL_FROM')
      return new ResendMailer(apiKey, from)
    }
    case 'log':
      return new LogMailer(logger)
    default:
      throw new Error('Thiếu MAIL_PROVIDER hợp lệ (resend hoặc log)')
  }
}
