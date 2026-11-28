import { describe, expect, it } from 'vitest'
import { LlmUnavailableError, ScriptedLlm } from '../src/core/adapters/llm.ts'
import { publishPrivacyPolicy } from './support/customer.ts'
import { OWNER, appWithOwner, bearer, createStaff, login } from './support/staff.ts'

const vnToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())

async function reportApp(llm: ScriptedLlm) {
  const app = await appWithOwner({ llm })
  await publishPrivacyPolicy(app.request)
  const { accessToken: ownerToken } = await login(app.request, OWNER.email, OWNER.password)
  await app.request
    .put('/api/admin/chatbot/settings')
    .set(bearer(ownerToken))
    .send({ enabled: true, responseTimeNote: '' })
  const report = (query: Record<string, string>) =>
    app.request.get('/api/admin/reports/chatbot').query(query).set(bearer(ownerToken))
  return { ...app, ownerToken, report }
}

describe('báo cáo chatbot', () => {
  it('cần chatbot.manage: kế toán có report.view vẫn 403; owner xem được', async () => {
    const { request, ownerToken, report } = await reportApp(new ScriptedLlm())
    const accountant = await createStaff(request, ownerToken, ['accountant'])
    const query = { from: vnToday(), to: vnToday() }
    expect(
      (await request.get('/api/admin/reports/chatbot').query(query).set(bearer(accountant.accessToken))).status,
    ).toBe(403)
    expect((await report(query)).status).toBe(200)
    // M7 reports still only need report.view.
    expect(
      (await request.get('/api/admin/reports/revenue').query(query).set(bearer(accountant.accessToken))).status,
    ).toBe(200)
  })

  it('đếm cuộc, tin, cuộc đã chuyển, lượt hết lượt và lỗi; số theo model khớp lượt gọi đã ghi', async () => {
    const llm = new ScriptedLlm([
      {
        content: 'Có ạ.',
        model: 'groq:qwen/qwen3.8-27b',
        usage: { input: 800, output: 40 },
        attempts: [
          { model: 'groq:openai/gpt-oss-120b', outcome: 'rate_limited' },
          { model: 'groq:qwen/qwen3.8-27b', outcome: 'ok' },
        ],
      },
      { content: 'Dạ.', model: 'groq:qwen/qwen3.8-27b', usage: { input: 600, output: 20 } },
      new LlmUnavailableError('exhausted', []),
      new LlmUnavailableError('failed', [{ model: 'groq:qwen/qwen3.8-27b', outcome: 'error' }]),
    ])
    const { request, report } = await reportApp(llm)
    const ask = (content: string, ip: string, conversationId?: string) =>
      request.post('/api/chat/messages').set('X-Forwarded-For', ip).send({ content, conversationId })
    const first = (await ask('Có túi đen không?', '203.0.113.91')).body.conversationId as string
    await ask('Màu nâu?', '203.0.113.91', first)
    await ask('Còn giày?', '203.0.113.92')
    await ask('Đồng hồ?', '203.0.113.93')
    expect(
      (await request.post('/api/chat/handoff').send({ conversationId: first, name: 'Lan', email: 'lan@example.com' }))
        .status,
    ).toBe(201)

    const body = (await report({ from: vnToday(), to: vnToday() })).body
    expect(body.total).toEqual({
      conversations: 3,
      customerMessages: 4,
      handedOff: 1,
      handoffRate: 1 / 3,
      exhaustedTurns: 1,
      failedTurns: 1,
    })
    expect(body.rows).toEqual([{ period: vnToday(), conversations: 3, customerMessages: 4, handedOff: 1 }])
    expect(body.models).toEqual([
      { model: 'groq:qwen/qwen3.8-27b', calls: 3, inputTokens: 1400, outputTokens: 60, rateLimited: 0, errors: 1 },
      { model: 'groq:openai/gpt-oss-120b', calls: 1, inputTokens: 0, outputTokens: 0, rateLimited: 1, errors: 0 },
    ])
  })

  it('cuộc mở lúc 23:30 giờ Việt Nam thuộc đúng ngày đó; kỳ không có cuộc thì tỷ lệ chuyển là null', async () => {
    const { request, prisma, report } = await reportApp(new ScriptedLlm())
    const id = (await request.post('/api/chat/messages').send({ content: 'Có túi đen không?' })).body.conversationId
    // No API changes timestamps: move the conversation and messages to 23:30 Vietnam time on 1/11 (16:30 UTC).
    const at = new Date('2026-11-01T16:30:00Z')
    await prisma.chatConversation.update({ where: { id }, data: { createdAt: at, lastMessageAt: at } })
    await prisma.chatMessage.updateMany({ where: { conversationId: id }, data: { createdAt: at } })

    const body = (await report({ from: '2026-11-01', to: '2026-11-02' })).body
    expect(body.rows).toEqual([
      { period: '2026-11-01', conversations: 1, customerMessages: 1, handedOff: 0 },
      { period: '2026-11-02', conversations: 0, customerMessages: 0, handedOff: 0 },
    ])
    expect((await report({ from: '2026-10-01', to: '2026-10-31' })).body.total.handoffRate).toBeNull()
    expect((await report({ from: '2026-11-02', to: '2026-11-01' })).status).toBe(400)
  })
})
