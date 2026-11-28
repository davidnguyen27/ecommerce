import { describe, expect, it } from 'vitest'
import {
  LlmChain,
  LlmUnavailableError,
  ScriptedLlm,
  type LlmClient,
  type LlmMessage,
} from '../src/core/adapters/llm.ts'
import { ENGLISH_REMINDER, HISTORY_LIMIT, SYSTEM_PROMPT } from '../src/chat/prompt.ts'
import { deleteExpiredRecords } from '../src/core/jobs/cleanup.ts'
import { OWNER, appWithOwner, bearer, createStaff, login, type Request } from './support/staff.ts'

const DAY = 24 * 60 * 60_000

/** App with an owner; the owner turns the chatbot on via the API unless `enabled: false`. */
async function chatApp(options: { llm?: LlmClient; enabled?: boolean } = {}) {
  const app = await appWithOwner({ llm: options.llm })
  const { accessToken } = await login(app.request, OWNER.email, OWNER.password)
  if (options.enabled !== false) {
    const res = await app.request
      .put('/api/admin/chatbot/settings')
      .set(bearer(accessToken))
      .send({ enabled: true, responseTimeNote: '' })
    expect(res.status).toBe(200)
  }
  return { ...app, ownerToken: accessToken }
}

function ask(request: Request, content: string, conversationId?: string, ip = '203.0.113.10') {
  return request.post('/api/chat/messages').set('X-Forwarded-For', ip).send({ content, conversationId })
}

/** Customer and chatbot messages the model received, system messages dropped. */
const dialogue = (messages: LlmMessage[]) => messages.filter((m) => m.role !== 'system').map((m) => m.content)

describe('trạng thái chatbot', () => {
  it('mặc định tắt; bật mà máy chủ chưa có khóa thì chưa cấu hình; có model thì trả lời được, kèm câu quyền riêng tư', async () => {
    const off = await chatApp({ llm: new ScriptedLlm(), enabled: false })
    expect((await off.request.get('/api/chat/status')).body).toMatchObject({ available: false, reason: 'disabled' })

    const noKey = await chatApp()
    expect((await noKey.request.get('/api/chat/status')).body).toMatchObject({
      available: false,
      reason: 'unconfigured',
    })

    const on = await chatApp({ llm: new ScriptedLlm() })
    const status = await on.request.get('/api/chat/status')
    expect(status.body).toMatchObject({ available: true, reason: null })
    expect(status.body.privacyNotice).toContain('90 ngày')
  })

  it('tắt hay chưa có khóa thì không lưu tin, không gọi model', async () => {
    const llm = new ScriptedLlm()
    const { request } = await chatApp({ llm, enabled: false })
    const res = await ask(request, 'Có túi đen không?')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      conversationId: null,
      outcome: 'disabled',
      reply: null,
      cards: [],
      handoffSuggested: false,
    })
    expect(llm.requests).toHaveLength(0)

    const noKey = await chatApp()
    expect((await ask(noKey.request, 'Có túi đen không?')).body.outcome).toBe('unconfigured')
  })
})

describe('hỏi chatbot', () => {
  it('tin đầu mở cuộc mới; tin sau nối vào cuộc đó; đọc lại được cả cuộc', async () => {
    const llm = new ScriptedLlm([{ content: 'Mình có 2 mẫu túi đen.' }, { content: 'Mẫu Coach giá 4.890.000đ.' }])
    const { request } = await chatApp({ llm })

    const first = await ask(request, 'Có túi đen không?')
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({
      outcome: 'answered',
      reply: { role: 'assistant', content: 'Mình có 2 mẫu túi đen.', failed: false },
    })
    const conversationId = first.body.conversationId as string

    const second = await ask(request, 'Mẫu Coach bao nhiêu?', conversationId)
    expect(second.body.conversationId).toBe(conversationId)

    const view = await request.get(`/api/chat/conversations/${conversationId}`)
    expect(view.status).toBe(200)
    expect(view.body.active).toBe(true)
    expect(view.body.messages.map((m: { role: string; content: string }) => [m.role, m.content])).toEqual([
      ['customer', 'Có túi đen không?'],
      ['assistant', 'Mình có 2 mẫu túi đen.'],
      ['customer', 'Mẫu Coach bao nhiêu?'],
      ['assistant', 'Mẫu Coach giá 4.890.000đ.'],
    ])
  })

  it('model nhận system prompt, các tin trước, tin mới, rồi lời nhắc ngôn ngữ ở cuối', async () => {
    const llm = new ScriptedLlm([{ content: 'Có ạ.' }])
    const { request } = await chatApp({ llm })
    const first = await ask(request, 'Có túi đen không?')
    await ask(request, 'Do you ship to Hanoi?', first.body.conversationId)

    const messages = llm.requests[1]!.messages
    // System prompt, with policy page slugs if any.
    expect(messages[0]).toEqual({ role: 'system', content: expect.stringContaining(SYSTEM_PROMPT) })
    // Last message in English: the English reply reminder.
    expect(messages.at(-1)).toEqual({ role: 'system', content: ENGLISH_REMINDER })
    expect(dialogue(messages)).toEqual(['Có túi đen không?', 'Có ạ.', 'Do you ship to Hanoi?'])
  })

  it(`model chỉ nhận ${HISTORY_LIMIT} tin gần nhất`, async () => {
    const llm = new ScriptedLlm()
    const { request } = await chatApp({ llm })
    let conversationId: string | undefined
    for (let i = 1; i <= 6; i++) conversationId = (await ask(request, `Câu ${i}`, conversationId)).body.conversationId

    // A conversation with 11 messages (6 questions, 5 answers): the first, "Câu 1", is dropped.
    expect(dialogue(llm.requests.at(-1)!.messages)).toEqual([
      'Trợ lý thử: Câu 1',
      ...[2, 3, 4, 5].flatMap((i) => [`Câu ${i}`, `Trợ lý thử: Câu ${i}`]),
      'Câu 6',
    ])
  })

  it('cuộc đã im quá 24 giờ thì tin tiếp theo mở cuộc mới; mã lạ hay không thấy cũng mở cuộc mới', async () => {
    const { request, prisma } = await chatApp({ llm: new ScriptedLlm() })
    const old = (await ask(request, 'Câu hôm qua')).body.conversationId as string
    // No API changes timestamps: move the conversation's last message 25 hours back.
    await prisma.chatConversation.update({
      where: { id: old },
      data: { lastMessageAt: new Date(Date.now() - DAY - 3600_000) },
    })

    const next = await ask(request, 'Câu hôm nay', old)
    expect(next.body.conversationId).not.toBe(old)
    expect((await request.get(`/api/chat/conversations/${old}`)).body.active).toBe(false)

    const unknown = await ask(request, 'Hỏi tiếp', '7f1c1e10-0000-4000-8000-000000000000')
    expect(unknown.body.outcome).toBe('answered')
    expect(unknown.body.conversationId).not.toBe('7f1c1e10-0000-4000-8000-000000000000')
    expect((await request.get('/api/chat/conversations/khong-phai-uuid')).status).toBe(404)
  })
})

describe('giới hạn', () => {
  it('tin rỗng hay dài quá 500 ký tự thì 400', async () => {
    const { request } = await chatApp({ llm: new ScriptedLlm() })
    expect((await ask(request, '   ')).status).toBe(400)
    expect((await ask(request, 'a'.repeat(501))).status).toBe(400)
    expect((await ask(request, 'a'.repeat(500))).status).toBe(200)
  })

  it('tin thứ 31 trong một cuộc thì 429; cuộc mới vẫn hỏi được', async () => {
    const { request, prisma } = await chatApp({ llm: new ScriptedLlm() })
    const conversationId = (await ask(request, 'Câu 1')).body.conversationId as string
    // Sending 30 messages costs 60 writes; set the conversation counter to 30 directly.
    await prisma.chatConversation.update({ where: { id: conversationId }, data: { customerMessageCount: 30 } })

    const blocked = await ask(request, 'Câu 31', conversationId)
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('RATE_LIMITED')
    expect((await request.get(`/api/chat/conversations/${conversationId}`)).body.active).toBe(false)
    expect((await ask(request, 'Câu mới')).status).toBe(200)
  })

  it('tin thứ 61 trong một giờ từ một IP thì 429, kể cả khi chatbot tắt; IP khác vẫn gửi được', async () => {
    const { request } = await chatApp({ enabled: false })
    for (let i = 0; i < 60; i++) expect((await ask(request, `Câu ${i}`, undefined, '203.0.113.20')).status).toBe(200)

    const blocked = await ask(request, 'Câu 61', undefined, '203.0.113.20')
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0)
    expect((await ask(request, 'Câu khác', undefined, '203.0.113.21')).status).toBe(200)
  })
})

describe('khi model không trả lời được', () => {
  it('lỗi hay hết lượt thì tin của khách vẫn được lưu, đánh dấu không có trả lời', async () => {
    const llm = new ScriptedLlm([new LlmUnavailableError('failed', []), new Error('mạng hỏng')])
    const { request } = await chatApp({ llm })

    const failed = await ask(request, 'Có túi đen không?')
    expect(failed.body).toMatchObject({ outcome: 'failed', reply: null })
    const conversationId = failed.body.conversationId as string
    expect((await ask(request, 'Còn không?', conversationId)).body.outcome).toBe('failed')

    const view = await request.get(`/api/chat/conversations/${conversationId}`)
    expect(view.body.messages.map((m: { failed: boolean }) => m.failed)).toEqual([true, true])
  })

  it('cả chuỗi trả 429 thì báo hết lượt; trạng thái thành hết lượt và lượt sau không gọi model', async () => {
    let calls = 0
    const llm = new LlmChain(
      [{ provider: 'groq', model: 'openai/gpt-oss-120b', baseUrl: 'https://groq.test', apiKey: 'k', timeoutMs: 1000 }],
      {
        fetch: async () => {
          calls++
          return new Response('{}', { status: 429, headers: { 'retry-after': '3600' } })
        },
      },
    )
    const { request } = await chatApp({ llm })

    expect((await ask(request, 'Có túi đen không?')).body.outcome).toBe('exhausted')
    expect((await request.get('/api/chat/status')).body).toMatchObject({ available: false, reason: 'exhausted' })
    expect((await ask(request, 'Còn không?')).body.outcome).toBe('exhausted')
    expect(calls).toBe(1)
  })

  it('ghi lượt gọi và token theo model, kể cả model trả 429 trước khi model sau trả lời', async () => {
    const llm = new ScriptedLlm([
      {
        content: 'Có ạ.',
        model: 'groq:qwen/qwen3.8-27b',
        usage: { input: 700, output: 50 },
        attempts: [
          { model: 'groq:openai/gpt-oss-120b', outcome: 'rate_limited' },
          { model: 'groq:qwen/qwen3.8-27b', outcome: 'ok' },
        ],
      },
      new LlmUnavailableError('failed', [
        { model: 'groq:openai/gpt-oss-120b', outcome: 'skipped' },
        { model: 'groq:qwen/qwen3.8-27b', outcome: 'error' },
      ]),
    ])
    const { request, ownerToken } = await chatApp({ llm })
    await ask(request, 'Có túi đen không?')
    await ask(request, 'Còn không?')

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
    const report = await request
      .get('/api/admin/reports/chatbot')
      .query({ from: today, to: today })
      .set(bearer(ownerToken))
    expect(report.body.models).toEqual([
      { model: 'groq:qwen/qwen3.8-27b', calls: 2, inputTokens: 700, outputTokens: 50, rateLimited: 0, errors: 1 },
      { model: 'groq:openai/gpt-oss-120b', calls: 1, inputTokens: 0, outputTokens: 0, rateLimited: 1, errors: 0 },
    ])
  })
})

describe('cài đặt chatbot', () => {
  it('chỉ người có chatbot.manage đọc và sửa được', async () => {
    const { request, ownerToken } = await chatApp()
    const sales = await createStaff(request, ownerToken, ['sales'])
    expect((await request.get('/api/admin/chatbot/settings').set(bearer(sales.accessToken))).status).toBe(403)
    expect(
      (
        await request
          .put('/api/admin/chatbot/settings')
          .set(bearer(sales.accessToken))
          .send({ enabled: false, responseTimeNote: '' })
      ).status,
    ).toBe(403)
  })

  it('đổi cài đặt có audit; gửi lại y nguyên thì không ghi gì; câu thời gian phản hồi quá 300 ký tự thì 400', async () => {
    const { request, ownerToken } = await chatApp({ enabled: false })
    const settings = { enabled: true, responseTimeNote: 'Nhân viên trả lời trong giờ hành chính, thứ 2 đến thứ 7.' }
    const put = () => request.put('/api/admin/chatbot/settings').set(bearer(ownerToken)).send(settings)

    expect((await put()).body).toEqual(settings)
    expect((await put()).status).toBe(200)
    expect((await request.get('/api/admin/chatbot/settings').set(bearer(ownerToken))).body).toEqual(settings)

    const audit = await request.get('/api/admin/audit').query({ entityType: 'chatbot' }).set(bearer(ownerToken))
    expect(audit.body.items).toHaveLength(1)
    expect(audit.body.items[0]).toMatchObject({
      action: 'chatbot.settings.update',
      before: { enabled: false, responseTimeNote: '' },
      after: settings,
    })

    const tooLong = await request
      .put('/api/admin/chatbot/settings')
      .set(bearer(ownerToken))
      .send({ enabled: true, responseTimeNote: 'x'.repeat(301) })
    expect(tooLong.status).toBe(400)
  })
})

// The cleanup job has no endpoint; call the job function directly, then check via HTTP.
describe('xóa cuộc trò chuyện cũ', () => {
  it('cuộc có tin cuối quá 90 ngày bị xóa, cuộc mới hơn được giữ', async () => {
    const { request, prisma } = await chatApp({ llm: new ScriptedLlm() })
    const old = (await ask(request, 'Câu cũ')).body.conversationId as string
    const recent = (await ask(request, 'Câu mới', undefined, '203.0.113.30')).body.conversationId as string
    await prisma.chatConversation.update({
      where: { id: old },
      data: { lastMessageAt: new Date(Date.now() - 91 * DAY) },
    })

    const deleted = await deleteExpiredRecords(prisma)
    expect(deleted.chatConversations).toBe(1)
    expect((await request.get(`/api/chat/conversations/${old}`)).status).toBe(404)
    expect((await request.get(`/api/chat/conversations/${recent}`)).status).toBe(200)
  })
})
