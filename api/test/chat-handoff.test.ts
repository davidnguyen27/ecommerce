import { describe, expect, it } from 'vitest'
import { ScriptedLlm } from '../src/adapters/llm.ts'
import { deleteExpiredRecords } from '../src/jobs/cleanup.ts'
import { CUSTOMER, customerLogin, publishPrivacyPolicy, register, tokenFromMail } from './support/customer.ts'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

const GUEST = { name: 'Lan', email: 'lan@example.com' }

/** App có owner, chính sách bảo mật, chatbot bật với câu thời gian phản hồi; model giả đề nghị chuyển ở lượt đầu. */
async function handoffApp() {
  const llm = new ScriptedLlm([
    {
      toolCalls: [
        { id: 'h1', name: 'handoff', arguments: JSON.stringify({ summary: 'Khách nghi túi không chính hãng' }) },
      ],
    },
    { content: 'Bạn bấm nút xác nhận bên dưới nhé.' },
  ])
  const app = await appWithOwner({ llm })
  await publishPrivacyPolicy(app.request)
  const { accessToken: ownerToken } = await login(app.request, OWNER.email, OWNER.password)
  const settings = await app.request
    .put('/api/admin/chatbot/settings')
    .set(bearer(ownerToken))
    .send({ enabled: true, responseTimeNote: 'Nhân viên trả lời trong giờ hành chính.' })
  expect(settings.status).toBe(200)
  return { ...app, ownerToken }
}

async function conversationWithHandoff(request: Request) {
  const res = await request
    .post('/api/chat/messages')
    .send({ content: 'Túi này có chính hãng không? Cho gặp nhân viên' })
  expect(res.body.handoffSuggested).toBe(true)
  return res.body.conversationId as string
}

function handoff(request: Request, body: Record<string, unknown>, ip = '203.0.113.40') {
  return request.post('/api/chat/handoff').set('X-Forwarded-For', ip).send(body)
}

describe('khách vãng lai chuyển nhân viên', () => {
  it('tạo yêu cầu "khác" do chatbot tạo, tiêu đề là tóm tắt của chatbot; khách nhận email có link theo dõi', async () => {
    const { request, mailer, ownerToken } = await handoffApp()
    const conversationId = await conversationWithHandoff(request)

    const res = await handoff(request, { conversationId, ...GUEST, message: 'Mình muốn xem hóa đơn nhập.' })
    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      requestCode: expect.any(Number),
      responseTimeNote: 'Nhân viên trả lời trong giờ hành chính.',
      link: null,
    })
    const code = res.body.requestCode as number

    const token = await tokenFromMail(mailer, `/yeu-cau/${code}`, GUEST.email)
    const view = await request.get(`/api/support-requests/${code}`).query({ token })
    expect(view.status).toBe(200)
    expect(view.body).toMatchObject({ code, kind: 'other', subject: 'Khách nghi túi không chính hãng' })
    expect(view.body.messages.map((m: { author: string; body: string }) => [m.author, m.body])).toEqual([
      ['customer', 'Mình muốn xem hóa đơn nhập.'],
    ])

    const admin = await request.get(`/api/admin/support-requests/${code}`).set(bearer(ownerToken))
    expect(admin.body).toMatchObject({
      createdBy: 'chatbot',
      customerId: null,
      orderCode: null,
      ...{ contactEmail: GUEST.email, contactName: GUEST.name },
    })
    expect(admin.body.chatTranscript.map((m: { role: string }) => m.role)).toEqual(['customer', 'assistant'])
  })

  it('khách trả lời được qua link; token sai hay thiếu thì không thấy yêu cầu', async () => {
    const { request, mailer } = await handoffApp()
    const res = await handoff(request, { ...GUEST, message: 'Shop có giao Đà Nẵng không?' })
    expect(res.status).toBe(201)
    const code = res.body.requestCode as number
    const token = await tokenFromMail(mailer, `/yeu-cau/${code}`, GUEST.email)

    const reply = await request
      .post(`/api/support-requests/${code}/messages`)
      .query({ token })
      .send({ message: 'Thêm: giao trong tuần.' })
    expect(reply.status).toBe(200)
    expect(reply.body.messages).toHaveLength(2)
    expect((await request.get(`/api/support-requests/${code}`).query({ token: 'sai' })).status).toBe(404)
    expect((await request.get(`/api/support-requests/${code}`)).status).toBe(404)
    // Đường này không tạo được yêu cầu mới.
    expect(
      (await request.post('/api/support-requests').query({ token }).send({ kind: 'other', subject: 'a', message: 'b' }))
        .status,
    ).toBe(404)
  })

  it('thiếu tên, email, hay không có cuộc trò chuyện mà cũng không có lời nhắn thì 400; mã cuộc lạ thì 404', async () => {
    const { request } = await handoffApp()
    expect((await handoff(request, { email: GUEST.email, message: 'Hỏi' })).status).toBe(400)
    expect((await handoff(request, { name: GUEST.name, message: 'Hỏi' })).status).toBe(400)
    expect((await handoff(request, { ...GUEST, email: 'khong-phai-email', message: 'Hỏi' })).status).toBe(400)
    expect((await handoff(request, { ...GUEST })).status).toBe(400)
    expect((await handoff(request, { ...GUEST, conversationId: '7f1c1e10-0000-4000-8000-000000000000' })).status).toBe(
      404,
    )
  })

  it('mỗi cuộc trò chuyện chỉ chuyển một lần', async () => {
    const { request, ownerToken } = await handoffApp()
    const conversationId = await conversationWithHandoff(request)
    expect((await handoff(request, { conversationId, ...GUEST })).status).toBe(201)
    const again = await handoff(request, { conversationId, ...GUEST })
    expect(again.status).toBe(409)
    expect((await request.get('/api/admin/support-requests').set(bearer(ownerToken))).body.total).toBe(1)
  })

  it('mỗi IP chuyển tối đa 3 lần mỗi ngày; mỗi email tối đa 3 yêu cầu đang mở', async () => {
    const { request } = await handoffApp()
    for (let i = 0; i < 3; i++) {
      expect(
        (await handoff(request, { name: 'A', email: `a${i}@example.com`, message: 'Hỏi' }, '203.0.113.50')).status,
      ).toBe(201)
    }
    const blocked = await handoff(request, { name: 'A', email: 'a9@example.com', message: 'Hỏi' }, '203.0.113.50')
    expect(blocked.status).toBe(429)

    for (let i = 0; i < 3; i++) {
      expect((await handoff(request, { ...GUEST, message: `Hỏi ${i}` }, `203.0.113.${60 + i}`)).status).toBe(201)
    }
    const fourth = await handoff(request, { ...GUEST, message: 'Hỏi lần 4' }, '203.0.113.70')
    expect(fourth.status).toBe(409)
  })
})

describe('khách đã đăng nhập chuyển nhân viên', () => {
  it('không cần tên, email; yêu cầu gắn vào tài khoản và hiện ở trang tài khoản', async () => {
    const { request } = await handoffApp()
    expect((await register(request)).status).toBe(201)
    const { accessToken } = (await customerLogin(request, CUSTOMER.email, CUSTOMER.password)).body as {
      accessToken: string
    }
    const conversationId = await conversationWithHandoff(request)

    const res = await handoff(request, { conversationId }).set(bearer(accessToken))
    expect(res.status).toBe(201)
    expect(res.body.link).toBe(`/tai-khoan/yeu-cau/${res.body.requestCode}`)
    const mine = await request.get('/api/account/support-requests').set(bearer(accessToken))
    expect(mine.body.items.map((r: { code: number }) => r.code)).toEqual([res.body.requestCode])
  })
})

describe('nhân viên và dữ liệu', () => {
  it('nhân viên bán hàng đọc được bản chép; yêu cầu tạo từ form khác không có bản chép', async () => {
    const { request, ownerToken } = await handoffApp()
    const sales = await createStaff(request, ownerToken, ['sales'])
    const conversationId = await conversationWithHandoff(request)
    const fromChat = (await handoff(request, { conversationId, ...GUEST })).body.requestCode as number

    const view = await request.get(`/api/admin/support-requests/${fromChat}`).set(bearer(sales.accessToken))
    expect(view.body.chatTranscript).toHaveLength(2)
    expect(view.body.messages[0].body).toContain('trợ lý tư vấn')

    const noChat = (await handoff(request, { name: 'B', email: 'b@example.com', message: 'Hỏi' })).body
      .requestCode as number
    expect(
      (await request.get(`/api/admin/support-requests/${noChat}`).set(bearer(sales.accessToken))).body.chatTranscript,
    ).toBeNull()
  })

  // Ràng buộc trong DB không có đường HTTP nào chạm tới (API luôn đi đúng): thử bằng SQL trực tiếp.
  it('DB chặn yêu cầu không đơn, không tài khoản mà không do chatbot tạo, và yêu cầu khác "khác" không có đơn', async () => {
    const { prisma } = await handoffApp()
    const insert = (kind: string, createdBy: string) =>
      prisma.$executeRawUnsafe(
        `INSERT INTO "support_request" ("id", "kind", "subject", "contact_email", "created_by", "updated_at")
         VALUES (gen_random_uuid(), $1::support_request_kind, 'x', 'x@example.com', $2::support_author, now())`,
        kind,
        createdBy,
      )
    await expect(insert('other', 'customer')).rejects.toThrow(/support_request_order_check/)
    await expect(insert('return', 'chatbot')).rejects.toThrow(/support_request_order_check/)
    await expect(insert('other', 'chatbot')).resolves.toBe(1)
  })

  // Job dọn không có endpoint; gọi thẳng hàm job rồi kiểm qua HTTP.
  it('job dọn giữ cuộc trò chuyện đã chuyển nhân viên dù quá 90 ngày', async () => {
    const { request, prisma } = await handoffApp()
    const conversationId = await conversationWithHandoff(request)
    expect((await handoff(request, { conversationId, ...GUEST })).status).toBe(201)
    await prisma.chatConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date(Date.now() - 100 * 86_400_000) },
    })

    expect((await deleteExpiredRecords(prisma)).chatConversations).toBe(0)
    expect((await request.get(`/api/chat/conversations/${conversationId}`)).status).toBe(200)
  })
})

describe('nhận ra khách đòi gặp nhân viên', () => {
  it('khách nhắc tới nhân viên thì vẫn đề nghị chuyển dù model không gọi handoff; câu của khách làm tiêu đề yêu cầu', async () => {
    const llm = new ScriptedLlm([{ content: 'Túi này nhập khẩu chính ngạch ạ.' }, { content: 'Dạ, size 41 còn hàng.' }])
    const app = await appWithOwner({ llm })
    const { accessToken } = await login(app.request, OWNER.email, OWNER.password)
    await app.request
      .put('/api/admin/chatbot/settings')
      .set(bearer(accessToken))
      .send({ enabled: true, responseTimeNote: '' })

    const asked = await app.request.post('/api/chat/messages').send({ content: 'Cho mình gap nhan vien nhé' })
    expect(asked.body.handoffSuggested).toBe(true)
    const other = await app.request
      .post('/api/chat/messages')
      .send({ content: 'Size 41 còn không?', conversationId: asked.body.conversationId })
    expect(other.body.handoffSuggested).toBe(false)

    const res = await handoff(app.request, { conversationId: asked.body.conversationId, ...GUEST })
    const view = await app.request.get(`/api/admin/support-requests/${res.body.requestCode}`).set(bearer(accessToken))
    expect(view.body.subject).toBe('Cho mình gap nhan vien nhé')
  })
})
