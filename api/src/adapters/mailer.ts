export type Mail = {
  to: string
  subject: string
  text: string
  html?: string
}

/** Gửi email. Production dùng nhà cung cấp transactional; test đọc thư từ bản trong bộ nhớ. */
export interface Mailer {
  send(mail: Mail): Promise<void>
}

export class InMemoryMailer implements Mailer {
  readonly sent: Mail[] = []

  async send(mail: Mail) {
    this.sent.push(mail)
  }
}
