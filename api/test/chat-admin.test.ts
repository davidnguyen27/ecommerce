import { describe, expect, it } from 'vitest'
import { LlmUnavailableError, ScriptedLlm, type LlmClient } from '../src/core/adapters/llm.ts'
import { PROMPT_VERSION } from '../src/chat/prompt.ts'
import { publishPrivacyPolicy } from './support/customer.ts'
import { OWNER, appWithOwner, bearer, createStaff, login } from './support/staff.ts'

async function adminChatApp(llm?: LlmClient) {
  const app = await appWithOwner({ llm })
  await publishPrivacyPolicy(app.request)
  const { accessToken: ownerToken } = await login(app.request, OWNER.email, OWNER.password)
  await app.request
    .put('/api/admin/chatbot/settings')
    .set(bearer(ownerToken))
    .send({ enabled: true, responseTimeNote: '' })
  return { ...app, ownerToken }
}

describe('trang quản trị chatbot', () => {
  it('chỉ người có chatbot.manage xem được trạng thái model và cuộc trò chuyện', async () => {
    const { request, ownerToken } = await adminChatApp(new ScriptedLlm())
    const sales = await createStaff(request, ownerToken, ['sales'])
    for (const path of ['/api/admin/chatbot/status', '/api/admin/chatbot/conversations']) {
      expect((await request.get(path).set(bearer(sales.accessToken))).status).toBe(403)
      expect((await request.get(path).set(bearer(ownerToken))).status).toBe(200)
    }
  })

  it('trạng thái model: có model thì liệt kê từng model; máy chủ chưa có khóa thì báo chưa cấu hình', async () => {
    const withModel = await adminChatApp(new ScriptedLlm())
    expect((await withModel.request.get('/api/admin/chatbot/status').set(bearer(withModel.ownerToken))).body).toEqual({
      configured: true,
      models: [{ model: 'fake:scripted', exhaustedUntil: null }],
    })
    const noKey = await adminChatApp()
    expect((await noKey.request.get('/api/admin/chatbot/status').set(bearer(noKey.ownerToken))).body).toEqual({
      configured: false,
      models: [],
    })
  })

  it('danh sách lọc theo đã chuyển, có lỗi và khoảng ngày theo giờ Việt Nam; mới nhất trước', async () => {
    const llm = new ScriptedLlm([{ content: 'Có ạ.' }, new LlmUnavailableError('exhausted', []), { content: 'Dạ.' }])
    const { request, prisma, ownerToken } = await adminChatApp(llm)
    const ask = (content: string, ip: string) =>
      request.post('/api/chat/messages').set('X-Forwarded-For', ip).send({ content })
    const answered = (await ask('Có túi đen không?', '203.0.113.81')).body.conversationId as string
    const failed = (await ask('Còn giày không?', '203.0.113.82')).body.conversationId as string
    const handed = (await ask('Cho gặp nhân viên', '203.0.113.83')).body.conversationId as string
    expect(
      (await request.post('/api/chat/handoff').send({ conversationId: handed, name: 'Lan', email: 'lan@example.com' }))
        .status,
    ).toBe(201)
    // No API changes timestamps: move a conversation's last message to 23:30 Vietnam time on 1/11.
    await prisma.chatConversation.update({
      where: { id: answered },
      data: { lastMessageAt: new Date('2026-11-01T16:30:00Z') },
    })

    const list = (query: Record<string, string> = {}) =>
      request.get('/api/admin/chatbot/conversations').query(query).set(bearer(ownerToken))
    const ids = async (query: Record<string, string> = {}) =>
      (await list(query)).body.items.map((item: { id: string }) => item.id)

    const all = (await list()).body
    expect(all.total).toBe(3)
    expect(all.items.at(-1)).toMatchObject({
      id: answered,
      firstQuestion: 'Có túi đen không?',
      customerMessageCount: 1,
    })
    expect(await ids({ handedOff: 'true' })).toEqual([handed])
    expect(await ids({ handedOff: 'false' })).toEqual(expect.arrayContaining([answered, failed]))
    expect(await ids({ failed: 'true' })).toEqual([failed])
    expect(await ids({ from: '2026-11-01', to: '2026-11-01' })).toEqual([answered])
    expect(await ids({ from: '2026-11-02', to: '2026-11-02' })).toEqual([])
    const handedItem = all.items.find((item: { id: string }) => item.id === handed)
    expect(handedItem.supportRequestCode).toEqual(expect.any(Number))
  })

  it('chi tiết có model, phiên bản prompt, lỗi của lượt; không có IP; mã lạ là 404', async () => {
    const llm = new ScriptedLlm([
      { content: 'Có ạ.', model: 'groq:openai/gpt-oss-120b' },
      new LlmUnavailableError('failed', []),
    ])
    const { request, ownerToken } = await adminChatApp(llm)
    const id = (await request.post('/api/chat/messages').send({ content: 'Có túi đen không?' })).body.conversationId
    await request.post('/api/chat/messages').send({ content: 'Còn màu nâu?', conversationId: id })

    const detail = await request.get(`/api/admin/chatbot/conversations/${id}`).set(bearer(ownerToken))
    expect(detail.status).toBe(200)
    expect(
      detail.body.messages.map(
        (m: { role: string; model: string | null; promptVersion: number | null; error: string | null }) => [
          m.role,
          m.model,
          m.promptVersion,
          m.error,
        ],
      ),
    ).toEqual([
      ['customer', null, null, null],
      ['assistant', 'groq:openai/gpt-oss-120b', PROMPT_VERSION, null],
      ['customer', null, null, 'failed'],
    ])
    expect(JSON.stringify(detail.body)).not.toMatch(/ip/i)
    expect((await request.get('/api/admin/chatbot/conversations/khong-co').set(bearer(ownerToken))).status).toBe(404)
  })
})
