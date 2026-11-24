import { describe, expect, it, vi } from 'vitest'
import { register } from './support/customer.ts'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

type PublicRequest = {
  code: number
  kind: string
  status: string
  subject: string
  orderCode: number | null
  messages: { author: string; body: string }[]
}

/**
 * `shop()` with a sales clerk (handles requests) and a warehouse clerk (view only). `placed()` places a guest order and
 * returns its code and lookup token; `guest(placed)` calls the order's request API with the token.
 */
async function supportShop() {
  const app = await shop()
  const { request, token, checkout } = app
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')
  let n = 0
  const placed = async () => {
    n += 1
    const res = await checkout({
      address: { ...ADDRESS, email: `khach${n}@example.com`, phone: `09000000${String(n).padStart(2, '0')}` },
    })
    expect(res.status).toBe(201)
    return res.body as { code: number; token: string }
  }
  const guest = (order: { code: number; token: string }) => {
    const base = `/api/orders/${order.code}/support-requests`
    return {
      create: (body: Record<string, unknown> = {}) =>
        request
          .post(base)
          .query({ token: order.token })
          .send({ kind: 'other', subject: 'Hỏi về đơn', message: 'Khi nào giao?', ...body }),
      list: () => request.get(base).query({ token: order.token }),
      get: (code: number) => request.get(`${base}/${code}`).query({ token: order.token }),
      say: (code: number, message: string) =>
        request.post(`${base}/${code}/messages`).query({ token: order.token }).send({ message }),
    }
  }
  const admin = (as = sales.accessToken) => ({
    get: (code: number) => request.get(`/api/admin/support-requests/${code}`).set(bearer(as)),
    list: (query: Record<string, string> = {}) =>
      request.get('/api/admin/support-requests').query(query).set(bearer(as)),
    reply: (code: number, body: Record<string, unknown>) =>
      request.post(`/api/admin/support-requests/${code}/reply`).set(bearer(as)).send(body),
    claim: (code: number) => request.post(`/api/admin/support-requests/${code}/claim`).set(bearer(as)),
    assign: (code: number, staffId: string | null) =>
      request.post(`/api/admin/support-requests/${code}/assign`).set(bearer(as)).send({ staffId }),
    create: (body: Record<string, unknown>) =>
      request
        .post('/api/admin/support-requests')
        .set(bearer(as))
        .send({ kind: 'other', ...body }),
  })
  const mails = (to: string, subject: RegExp) => app.mailer.sent.filter((m) => m.to === to && subject.test(m.subject))
  const waitMail = (to: string, subject: RegExp, count = 1) =>
    vi.waitFor(
      () => {
        const found = mails(to, subject)
        if (found.length < count) throw new Error('Chưa có thư')
        return found
      },
      { timeout: 10_000, interval: 100 },
    )
  return { ...app, sales, warehouse, placed, guest, admin, mails, waitMail }
}

describe('khách vãng lai qua link tra cứu đơn', () => {
  it('tạo yêu cầu, xem, gửi tin; nhận email kèm link có token; link của đơn khác hay token sai thì 404', async () => {
    const { placed, guest, waitMail } = await supportShop()
    const order = await placed()
    const other = await placed()

    const created = await guest(order).create()

    expect(created.status).toBe(201)
    const request = created.body as PublicRequest
    expect(request).toMatchObject({
      kind: 'other',
      status: 'new',
      subject: 'Hỏi về đơn',
      orderCode: order.code,
      messages: [{ author: 'customer', body: 'Khi nào giao?' }],
    })
    const [mail] = await waitMail('khach1@example.com', /Đã nhận yêu cầu #YC/)
    expect(mail!.text).toContain(`/yeu-cau/${request.code}?don=${order.code}&token=`)

    expect((await guest(order).list()).body.items).toEqual([expect.objectContaining({ code: request.code })])
    expect((await guest(order).say(request.code, 'Bổ sung')).body.messages).toHaveLength(2)
    expect((await guest(other).get(request.code)).status).toBe(404)
    expect((await guest(other).say(request.code, 'x')).status).toBe(404)
    expect((await guest({ ...order, token: 'sai' }).get(request.code)).status).toBe(404)
    expect((await guest(order).get(999_999)).status).toBe(404)
  })

  it('loại khác "khác" chưa nhận; nội dung rỗng thì 400; tối đa 3 yêu cầu đang mở mỗi đơn', async () => {
    const { placed, guest } = await supportShop()
    const order = await placed()

    expect((await guest(order).create({ kind: 'return' })).status).toBe(400)
    expect((await guest(order).create({ message: '  ' })).status).toBe(400)
    for (let i = 0; i < 3; i++) expect((await guest(order).create()).status).toBe(201)
    expect((await guest(order).create()).status).toBe(409)
  })
})

describe('khách đã đăng nhập', () => {
  it('gửi yêu cầu không gắn đơn, xem ở tài khoản; khách khác không thấy', async () => {
    const { request } = await supportShop()
    const { accessToken } = (await register(request)).body as { accessToken: string }
    const other = (await register(request, { email: 'khac@example.com' })).body.accessToken as string

    const created = await request
      .post('/api/account/support-requests')
      .set(bearer(accessToken))
      .send({ kind: 'other', subject: 'Hỏi size', message: 'Giày này có size 46 không?' })

    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ orderCode: null, status: 'new' })
    const code = created.body.code as number
    const list = await request.get('/api/account/support-requests').set(bearer(accessToken))
    expect(list.body.items).toEqual([expect.objectContaining({ code })])
    expect((await request.get(`/api/account/support-requests/${code}`).set(bearer(other))).status).toBe(404)
    expect((await request.get('/api/account/support-requests').set(bearer(other))).body.items).toEqual([])
    expect((await request.get('/api/account/support-requests')).status).toBe(401)
  })

  it('gắn được vào đơn của chính mình, không gắn được vào đơn của người khác', async () => {
    const { request, placed } = await supportShop()
    const { accessToken } = (await register(request)).body as { accessToken: string }
    const strangers = await placed()

    const res = await request
      .post('/api/account/support-requests')
      .set(bearer(accessToken))
      .send({ kind: 'other', subject: 'x', message: 'y', orderCode: strangers.code })

    expect(res.status).toBe(404)
  })

  it('giới hạn 5 lần tạo mỗi giờ mỗi IP', async () => {
    const { request } = await supportShop()
    const statuses: number[] = []
    for (const email of ['a@example.com', 'b@example.com']) {
      const { accessToken } = (await register(request, { email })).body as { accessToken: string }
      for (let i = 0; i < 3; i++) {
        const res = await request
          .post('/api/account/support-requests')
          .set(bearer(accessToken))
          .send({ kind: 'other', subject: 'x', message: 'y' })
        statuses.push(res.status)
      }
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429])
  })
})

describe('nhân viên xử lý', () => {
  it('nhận việc, trả lời chờ khách, khách trả lời, ghi chú nội bộ, đóng; email đúng lúc; audit', async () => {
    const { placed, guest, admin, sales, waitMail, mails, request, token } = await supportShop()
    const order = await placed()
    const code = ((await guest(order).create()).body as PublicRequest).code

    const claimed = await admin().claim(code)
    expect(claimed.status).toBe(200)
    expect(claimed.body).toMatchObject({ status: 'in_progress', assignee: expect.objectContaining({ id: sales.id }) })

    const asked = await admin().reply(code, { message: 'Bạn cho xin ảnh hộp?', status: 'waiting_customer' })
    expect(asked.body.status).toBe('waiting_customer')
    await waitMail('khach1@example.com', /đã trả lời yêu cầu/)

    expect((await guest(order).say(code, 'Đây ạ')).body.status).toBe('in_progress')

    const noted = await admin().reply(code, { message: 'Khách quen, ưu tiên', internal: true })
    expect(noted.body.messages.at(-1)).toMatchObject({
      internal: true,
      staff: expect.objectContaining({ id: sales.id }),
    })
    const seen = (await guest(order).get(code)).body as PublicRequest
    expect(seen.messages.map((m) => m.body)).not.toContain('Khách quen, ưu tiên')

    const done = await admin().reply(code, { status: 'resolved' })
    expect(done.body).toMatchObject({ status: 'resolved', resolvedAt: expect.any(String) })
    await waitMail('khach1@example.com', /đã được xử lý xong/)
    // Internal notes send no email: one confirmation, one reply, one closing email.
    expect(mails('khach1@example.com', /YC/)).toHaveLength(3)

    expect((await guest(order).say(code, 'Còn nữa')).status).toBe(409)
    expect((await admin().reply(code, { message: 'x' })).status).toBe(409)

    const audits = await request.get('/api/admin/audit').set(bearer(token))
    const actions = (audits.body.items as { action: string }[]).map((a) => a.action)
    expect(actions).toEqual(
      expect.arrayContaining(['support.assign', 'support.reply', 'support.note', 'support.status']),
    )
  })

  it('không có tin và trạng thái không đổi thì không ghi gì; trống cả hai thì 400', async () => {
    const { placed, guest, admin, request, token } = await supportShop()
    const code = ((await guest(await placed()).create()).body as PublicRequest).code
    await admin().claim(code)
    const before = (await request.get('/api/admin/audit').set(bearer(token))).body.total as number

    expect((await admin().reply(code, { status: 'in_progress' })).status).toBe(200)
    expect((await admin().reply(code, {})).status).toBe(400)
    expect((await request.get('/api/admin/audit').set(bearer(token))).body.total).toBe(before)
  })

  it('đã có người nhận thì người khác không nhận được; chỉ owner giao; người được giao phải xử lý được yêu cầu', async () => {
    const { placed, guest, admin, sales, warehouse, request, token } = await supportShop()
    const code = ((await guest(await placed()).create()).body as PublicRequest).code
    const other = await createStaff(request, token, ['sales'], 'ban-hang-2@example.com')

    expect((await admin().claim(code)).status).toBe(200)
    expect((await admin(other.accessToken).claim(code)).status).toBe(409)
    expect((await admin().assign(code, other.id)).status).toBe(403)
    expect((await admin(token).assign(code, warehouse.id)).status).toBe(400)
    const reassigned = await admin(token).assign(code, other.id)
    expect(reassigned.body.assignee).toMatchObject({ id: other.id })
    expect((await admin(token).assign(code, null)).body.assignee).toBeNull()
    expect(sales.id).toBeDefined()
  })

  it('kho xem được nhưng không trả lời được', async () => {
    const { placed, guest, admin, warehouse } = await supportShop()
    const code = ((await guest(await placed()).create()).body as PublicRequest).code

    expect((await admin(warehouse.accessToken).get(code)).status).toBe(200)
    expect((await admin(warehouse.accessToken).reply(code, { message: 'x' })).status).toBe(403)
    expect((await admin(warehouse.accessToken).claim(code)).status).toBe(403)
  })

  it('tạo hộ theo mã đơn hay email tài khoản; email gửi khách; mã đơn lạ thì 400', async () => {
    const { placed, admin, request, waitMail } = await supportShop()
    const order = await placed()
    await register(request)

    const byOrder = await admin().create({ orderCode: order.code, subject: 'Khách gọi điện', message: 'Hỏi giờ giao' })
    expect(byOrder.status).toBe(201)
    expect(byOrder.body).toMatchObject({
      createdBy: 'staff',
      orderCode: order.code,
      contactEmail: 'khach1@example.com',
    })
    await waitMail('khach1@example.com', /Đã nhận yêu cầu/)

    const byEmail = await admin().create({ customerEmail: 'KHACH@example.com', subject: 'Zalo', message: 'Hỏi size' })
    expect(byEmail.status).toBe(201)
    expect(byEmail.body).toMatchObject({ orderCode: null, contactEmail: 'khach@example.com' })
    const [mail] = await waitMail('khach@example.com', /Đã nhận yêu cầu/)
    expect(mail!.text).toContain(`/tai-khoan/yeu-cau/${byEmail.body.code}`)

    expect((await admin().create({ orderCode: 999_999, subject: 'x', message: 'y' })).status).toBe(400)
    expect((await admin().create({ customerEmail: 'ai@example.com', subject: 'x', message: 'y' })).status).toBe(400)
    expect((await admin().create({ subject: 'x', message: 'y' })).status).toBe(400)
  })

  it('danh sách lọc chưa ai nhận, đang chờ nhân viên, theo đơn; chi tiết đơn có yêu cầu của đơn', async () => {
    const { placed, guest, admin, token, request } = await supportShop()
    const first = await placed()
    const second = await placed()
    const a = ((await guest(first).create()).body as PublicRequest).code
    const b = ((await guest(second).create()).body as PublicRequest).code
    await admin().claim(b)
    await admin().reply(b, { message: 'Chờ ảnh', status: 'waiting_customer' })

    const codes = async (query: Record<string, string>) =>
      ((await admin().list(query)).body.items as { code: number }[]).map((i) => i.code)
    expect(await codes({})).toEqual([a, b])
    expect(await codes({ unassigned: 'true' })).toEqual([a])
    expect(await codes({ status: 'awaiting_staff' })).toEqual([a])
    expect(await codes({ orderCode: String(second.code) })).toEqual([b])
    expect(await codes({ assignee: 'me' })).toEqual([b])

    const detail = await request.get(`/api/admin/orders/${first.code}`).set(bearer(token))
    expect(detail.body.supportRequests).toEqual([expect.objectContaining({ code: a, status: 'new' })])
  })

  it('nối tiếp yêu cầu đã kết thúc; yêu cầu còn mở thì không nối được', async () => {
    const { placed, guest, admin } = await supportShop()
    const order = await placed()
    const first = ((await guest(order).create()).body as PublicRequest).code

    expect((await guest(order).create({ previousRequestCode: first })).status).toBe(400)
    await admin().reply(first, { status: 'resolved' })
    const next = await guest(order).create({ previousRequestCode: first })
    expect(next.status).toBe(201)
    expect(next.body.previousRequestCode).toBe(first)
  })
})

describe('tên liên hệ', () => {
  it('yêu cầu không gắn đơn lấy tên từ địa chỉ nhận hàng gần nhất của tài khoản; chưa có thì để trống', async () => {
    const { admin, request, prisma } = await supportShop()
    await register(request)
    const without = await admin().create({ customerEmail: 'khach@example.com', subject: 'Zalo', message: 'Hỏi size' })
    expect(without.body.contactName).toBeNull()

    await prisma.customer.update({
      where: { email: 'khach@example.com' },
      data: { lastShippingAddress: { ...ADDRESS, email: 'khach@example.com' } },
    })
    const named = await admin().create({ customerEmail: 'khach@example.com', subject: 'Zalo', message: 'Hỏi màu' })
    expect(named.status).toBe(201)
    expect(named.body.contactName).toBe(ADDRESS.recipientName)
  })
})
