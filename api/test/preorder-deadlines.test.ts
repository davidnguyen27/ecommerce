import { describe, expect, it } from 'vitest'
import { processRemainderDeadlines } from '../src/modules/preorder-campaign/index.ts'
import { REMAINING, depositedPreorder } from './support/preorder.ts'
import { bearer } from './support/staff.ts'

const DAY = 24 * 60 * 60_000
const inDays = (days: number) => new Date(Date.now() + days * DAY)

/**
 * Deposited, arrived pre-orders: the remainder is due 7 days after arrival. The job has no endpoint: tests call it
 * with a future `now`, then check via HTTP.
 */
async function arrivedPreorder() {
  const app = await depositedPreorder()
  await app.arrive()
  const run = (now: Date) => processRemainderDeadlines(app.expireDeps, now)
  const history = async () => {
    const res = await app.request.get(`/api/admin/orders/${app.code}`).set(bearer(app.token))
    return (res.body.history as { action: string }[]).map((h) => h.action)
  }
  const reminders = () => app.mailer.sent.filter((m) => m.subject.includes(`Nhắc trả phần còn lại`))
  /** Waits for the mail queue to drain, so email counts are complete. */
  const settleMail = () => new Promise((resolve) => setTimeout(resolve, 500))
  return { ...app, run, history, reminders, settleMail }
}

describe('nhắc trả phần còn lại', () => {
  it('job chạy mỗi giờ', async () => {
    const { prisma } = await depositedPreorder()

    // The schedule lives in pg-boss with no endpoint: check with SQL.
    const schedules = await prisma.$queryRaw<{ cron: string }[]>`
      SELECT "cron" FROM "pgboss"."schedule" WHERE "name" = 'remainder-deadlines'`
    expect(schedules).toEqual([{ cron: '0 * * * *' }])
  })

  it('nhắc đúng một lần khi còn ≤ 2 ngày tới hạn; chạy lại không gửi thêm, không ghi thêm sự kiện', async () => {
    const app = await arrivedPreorder()

    expect(await app.run(inDays(4))).toEqual({ reminded: 0, flagged: 0 })
    expect(await app.run(inDays(5.5))).toEqual({ reminded: 1, flagged: 0 })
    expect(await app.run(inDays(6))).toEqual({ reminded: 0, flagged: 0 })

    await app.settleMail()
    const [mail, ...more] = app.reminders()
    expect(more).toEqual([])
    expect(mail).toMatchObject({ subject: `Nhắc trả phần còn lại đơn đặt trước #${app.code}` })
    expect(mail!.text).toContain('1.500.000')
    expect((await app.history()).filter((a) => a === 'remainder_reminded')).toHaveLength(1)
  })

  it('không nhắc đơn chưa về hàng, cũng không nhắc đơn đã trả đủ', async () => {
    const waiting = await depositedPreorder()
    expect(await processRemainderDeadlines(waiting.expireDeps, inDays(6))).toEqual({ reminded: 0, flagged: 0 })

    const app = await arrivedPreorder()
    await app.payRemainder()
    expect((await app.settle([REMAINING, 'FT-REM'])).body.paymentStatus).toBe('paid')
    expect(await app.run(inDays(6))).toEqual({ reminded: 0, flagged: 0 })
    expect(await app.run(inDays(8))).toEqual({ reminded: 0, flagged: 0 })
  })
})

describe('quá hạn trả phần còn lại', () => {
  it('gắn cờ quá hạn, không hủy đơn, hàng vẫn giữ; chạy lại không ghi thêm', async () => {
    const app = await arrivedPreorder()

    expect(await app.run(inDays(8))).toEqual({ reminded: 0, flagged: 1 })
    expect(await app.run(inDays(9))).toEqual({ reminded: 0, flagged: 0 })

    expect((await app.order()).body).toMatchObject({
      status: 'processing',
      paymentStatus: 'deposit_paid',
      preorder: { remainderOverdueAt: expect.any(String), arrivedQuantity: 1 },
    })
    const stock = await app.request.get('/api/admin/stock').query({ q: 'AM-41' }).set(bearer(app.token))
    expect(stock.body.items.find((i: { sku: string }) => i.sku === 'AM-41')).toMatchObject({ onHand: 1, reserved: 1 })
    expect((await app.history()).filter((a) => a === 'remainder_overdue')).toHaveLength(1)
  })

  it('trả sau khi quá hạn vẫn được: đơn đã trả đủ và hết cờ quá hạn', async () => {
    const app = await arrivedPreorder()
    await app.run(inDays(8))

    expect((await app.payRemainder()).status).toBe(200)
    const res = await app.settle([REMAINING, 'FT-REM'])

    expect(res.body).toMatchObject({ paymentStatus: 'paid', preorder: { remainderOverdueAt: null } })
  })
})
