import { describe, expect, it } from 'vitest'
import { ScriptedLlm, type LlmMessage, type LlmToolCall } from '../src/core/adapters/llm.ts'
import { SYSTEM_PROMPT, VIETNAMESE_REMINDER } from '../src/modules/chatbot/chatbot-prompt.ts'
import { MAX_TOOL_ROUNDS } from '../src/modules/chatbot/chatbot-turn.ts'
import { preorderShop } from './support/preorder.ts'
import { shop } from './support/shop.ts'
import { bearer, type Request } from './support/staff.ts'

/** `shop()` (Air Max published, returns policy published), with the chatbot on and a fake model. */
async function chatShop(llm = new ScriptedLlm()) {
  const app = await shop({ llm })
  const res = await app.request
    .put('/api/admin/chatbot/settings')
    .set(bearer(app.token))
    .send({ enabled: true, responseTimeNote: '' })
  expect(res.status).toBe(200)
  return { ...app, llm }
}

const call = (name: string, args: Record<string, unknown> = {}, id = `call-${name}`): LlmToolCall => ({
  id,
  name,
  arguments: JSON.stringify(args),
})

function ask(request: Request, content: string, extra: Record<string, unknown> = {}) {
  return request.post('/api/chat/messages').send({ content, ...extra })
}

/** The tool result the model received on call `index`, in call order. */
function toolOutputs(llm: ScriptedLlm, index: number) {
  return llm.requests[index]!.messages.flatMap((m: LlmMessage) =>
    m.role === 'tool' ? [JSON.parse(m.content) as Record<string, unknown>] : [],
  )
}

describe('tìm sản phẩm', () => {
  it('chatbot tìm được sản phẩm đã xuất bản; khung chat nhận thẻ dựng từ DB, tin lưu slug và tên', async () => {
    const { request, llm } = await chatShop(
      new ScriptedLlm([
        { toolCalls: [call('search_products', { text: 'Air Max', maxPrice: 3_000_000 })] },
        { content: 'Có Air Max, giá chỉ 1.000đ.' },
      ]),
    )
    const res = await ask(request, 'Có giày Air Max không?')
    expect(res.status).toBe(200)
    // The model wrote a wrong price; the card stays right since it comes from the DB.
    expect(res.body.cards).toHaveLength(1)
    expect(res.body.cards[0]).toMatchObject({ slug: 'air-max', name: 'Air Max', fromPrice: 2_000_000, inStock: true })
    expect(res.body.reply.products).toEqual([{ slug: 'air-max', name: 'Air Max' }])

    const [output] = toolOutputs(llm, 1)
    expect(output).toEqual({
      products: [
        {
          slug: 'air-max',
          name: 'Air Max',
          brand: 'Nike',
          fromPrice: 2_000_000,
          availability: 'in stock',
        },
      ],
    })

    const view = await request.get(`/api/chat/conversations/${res.body.conversationId}`)
    expect(view.body.messages[1].products).toEqual([{ slug: 'air-max', name: 'Air Max' }])
  })

  it('sản phẩm nháp không xuất hiện; thương hiệu tìm theo tên; quá ngân sách thì không có', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [call('search_products', { text: 'Air', brand: 'NIKE' })] },
      { content: 'Có Air Max.' },
      { toolCalls: [call('search_products', { text: 'Air Max', maxPrice: 1_000_000 })] },
      { content: 'Không có.' },
    ])
    const { request, token, brand, category } = await chatShop(llm)
    const draft = await request
      .post('/api/admin/products')
      .set(bearer(token))
      .send({
        brandId: brand.id,
        categoryId: category.id,
        name: 'Air Force',
        slug: 'air-force',
        attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
      })
    expect(draft.status).toBe(201)

    const found = await ask(request, 'Giày Nike nào có?')
    expect(found.body.cards.map((c: { slug: string }) => c.slug)).toEqual(['air-max'])
    const tooCheap = await ask(request, 'Dưới 1 triệu có không?')
    expect(tooCheap.body.cards).toEqual([])
    // Neither keyword nor price matches: retrying without the keyword is empty too, with a note.
    expect(toolOutputs(llm, 3)).toEqual([{ products: [], note: expect.any(String) }])
  })

  it('lọc theo màu khi biết nhóm hàng; từ khóa không khớp tên nào thì tìm lại theo các bộ lọc còn lại', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [call('search_products', { productType: 'footwear', color: 'đen' })] },
      { content: 'Có.' },
      { toolCalls: [call('search_products', { productType: 'footwear', color: 'Trắng' })] },
      { content: 'Không có.' },
      { toolCalls: [call('search_products', { text: 'giày đi làm', productType: 'footwear', maxPrice: 3_000_000 })] },
      { content: 'Có Air Max.' },
    ])
    const { request } = await chatShop(llm)

    expect((await ask(request, 'Giày màu đen?')).body.cards.map((c: { slug: string }) => c.slug)).toEqual(['air-max'])
    expect((await ask(request, 'Giày màu trắng?')).body.cards).toEqual([])
    const fallback = await ask(request, 'Giày đi làm dưới 3 triệu?')
    expect(fallback.body.cards.map((c: { slug: string }) => c.slug)).toEqual(['air-max'])
    expect(toolOutputs(llm, 5)[0]).toMatchObject({ note: expect.any(String), products: [{ slug: 'air-max' }] })
  })
})

describe('chi tiết sản phẩm', () => {
  it('trả giá và tình trạng từng biến thể, đợt đặt trước đang mở, chính sách; không có số tồn, id hay SKU', async () => {
    const llm = new ScriptedLlm([{ toolCalls: [call('get_product', { slug: 'air-max' })] }, { content: 'Đây ạ.' }])
    const app = await preorderShop({ llm })
    await app.request
      .put('/api/admin/chatbot/settings')
      .set(bearer(app.token))
      .send({ enabled: true, responseTimeNote: '' })
    await app.open([{ variantId: app.v41.id, allocation: 5 }])

    await ask(app.request, 'Air Max size 41 còn không?')
    const [product] = toolOutputs(llm, 1)
    expect(product).toMatchObject({
      slug: 'air-max',
      name: 'Air Max',
      brand: 'Nike',
      policies: ['doi-tra'],
    })
    // One line per variant, to save tokens.
    expect(product!.variants).toEqual([
      'Đen / 40: 2000000 in stock',
      'Đen / 41: 2100000 pre-order (cọc 30%, dự kiến 2026-12-10 – 2026-12-20)',
    ])
    expect(product!.sizeChart).toBe('none')
    const raw = JSON.stringify(product)
    for (const hidden of [app.v40.id, app.v41.id, 'AM-40', 'onHand', 'reserved']) expect(raw).not.toContain(hidden)
  })

  it('không biết slug thì lấy theo tên, khỏi phải tìm trước', async () => {
    const llm = new ScriptedLlm([{ toolCalls: [call('get_product', { name: 'Air Max' })] }, { content: 'Đây ạ.' }])
    const { request } = await chatShop(llm)
    await ask(request, 'Air Max còn size nào?')
    expect(toolOutputs(llm, 1)[0]).toMatchObject({ slug: 'air-max', name: 'Air Max' })
  })

  it('slug không có hay sản phẩm nháp thì báo model tìm lại, không ném lỗi', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [call('get_product', { slug: 'khong-co' })] },
      { content: 'Không thấy.' },
    ])
    const { request } = await chatShop(llm)
    expect((await ask(request, 'Còn mẫu không có không?')).body.outcome).toBe('answered')
    expect(toolOutputs(llm, 1)[0]).toHaveProperty('error')
  })
})

describe('chính sách', () => {
  it('prompt liệt kê slug các trang chính sách đã xuất bản; chỉ đọc được trang đã xuất bản', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [call('get_policy', { slug: 'doi-tra' }), call('get_policy', { slug: 'bao-hanh' })] },
      { content: 'Đổi trong 7 ngày.' },
    ])
    const { request, token } = await chatShop(llm)
    const draft = await request
      .post('/api/admin/pages')
      .set(bearer(token))
      .send({ slug: 'bao-hanh', kind: 'policy', title: 'Bảo hành', body: 'Bản nháp' })
    expect(draft.status).toBe(201)

    await ask(request, 'Đổi trả thế nào?')
    const system = llm.requests[0]!.messages[0]!.content
    expect(system).toMatch(/Policy slugs: .*doi-tra/)
    expect(system).not.toContain('bao-hanh')
    const [policy, missing] = toolOutputs(llm, 1)
    expect(policy).toEqual({ slug: 'doi-tra', title: 'Đổi trả', body: 'Đổi trong 7 ngày' })
    expect(missing).toHaveProperty('error')
  })
})

describe('vòng lặp và ngữ cảnh', () => {
  it(`sau ${MAX_TOOL_ROUNDS} vòng công cụ thì gọi model không kèm công cụ để buộc trả lời; mỗi lần gọi đều được ghi`, async () => {
    const search = { toolCalls: [call('search_products', { text: 'Air' })] }
    const llm = new ScriptedLlm([search, search, search, { content: 'Mình gợi ý Air Max.' }])
    const { request, token } = await chatShop(llm)

    const res = await ask(request, 'Gợi ý giày?')
    expect(res.body.reply.content).toBe('Mình gợi ý Air Max.')
    expect(res.body.cards).toHaveLength(1)
    expect(llm.requests.map((r) => r.tools?.length ?? 0)).toEqual([4, 4, 4, 0])
    // Each call has exactly one language reminder, last, after the tool results.
    for (const { messages } of llm.requests) {
      expect(messages.filter((m) => m.role === 'system' && m.content === VIETNAMESE_REMINDER)).toHaveLength(1)
      expect(messages.at(-1)).toEqual({ role: 'system', content: VIETNAMESE_REMINDER })
    }

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date())
    const report = await request.get('/api/admin/reports/chatbot').query({ from: today, to: today }).set(bearer(token))
    expect(report.body.models).toEqual([expect.objectContaining({ model: 'fake:scripted', calls: 4 })])
  })

  it('sản phẩm khách đang xem đi vào như kết quả công cụ, không vào system message', async () => {
    const llm = new ScriptedLlm([{ content: 'Size 41 hết hàng ạ.' }, { content: 'Dạ.' }])
    const { request } = await chatShop(llm)

    await ask(request, 'Cái này còn size 41 không?', { viewingProductSlug: 'air-max' })
    const messages = llm.requests[0]!.messages
    expect(messages.filter((m) => m.role === 'system').map((m) => m.content)).toEqual([
      expect.stringMatching(new RegExp(`^${SYSTEM_PROMPT.slice(0, 40)}`)),
      VIETNAMESE_REMINDER,
    ])
    expect(toolOutputs(llm, 0)).toEqual([expect.objectContaining({ slug: 'air-max', name: 'Air Max' })])

    await ask(request, 'Còn mẫu khác không?', { viewingProductSlug: 'khong-co' })
    expect(toolOutputs(llm, 1)).toEqual([])
  })

  it('sản phẩm không có bảng size mà model vẫn đoán size thì gọi thêm một lần để viết lại, không gợi ý size', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [call('get_product', { slug: 'air-max' })] },
      { content: 'Chân 25 cm thì size 41 là phù hợp. Size 41 còn hàng.' },
      { content: 'Air Max không có bảng size nên mình không gợi ý size được. Size 41 còn hàng.' },
    ])
    const { request } = await chatShop(llm)

    const res = await ask(request, 'Chân 25 cm đi size nào?')
    expect(res.body.reply.content).toBe('Air Max không có bảng size nên mình không gợi ý size được. Size 41 còn hàng.')
    const rewrite = llm.requests[2]!
    expect(rewrite.tools).toBeUndefined()
    expect(rewrite.messages.some((m) => m.role === 'system' && m.content.includes('no size chart'))).toBe(true)
    expect(rewrite.messages.at(-1)).toEqual({ role: 'system', content: VIETNAMESE_REMINDER })
  })

  it('không đoán size (hay sản phẩm có bảng size) thì không gọi thêm', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [call('get_product', { slug: 'air-max' })] },
      { content: 'Air Max không có bảng size. Size 41 còn hàng.' },
    ])
    const { request } = await chatShop(llm)
    await ask(request, 'Size 41 còn không?')
    expect(llm.requests).toHaveLength(2)
  })

  it('sản phẩm khách đang xem không có bảng size: câu đoán size cũng được viết lại', async () => {
    const llm = new ScriptedLlm([
      { content: 'Size EU 41 sẽ vừa với bạn.' },
      { content: 'Sản phẩm không có bảng size.' },
    ])
    const { request } = await chatShop(llm)
    const res = await ask(request, 'Cái này mình đi size nào?', { viewingProductSlug: 'air-max' })
    expect(res.body.reply.content).toBe('Sản phẩm không có bảng size.')
    expect(llm.requests).toHaveLength(2)
  })

  it('chatbot đề nghị chuyển nhân viên thì khung chat được báo, nhưng không tạo yêu cầu nào', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [call('handoff', { summary: 'Khách nghi hàng không chính hãng' })] },
      { content: 'Bạn bấm nút xác nhận bên dưới nhé.' },
    ])
    const { request, token } = await chatShop(llm)

    const res = await ask(request, 'Cho mình gặp nhân viên')
    expect(res.body.handoffSuggested).toBe(true)
    const requests = await request.get('/api/admin/support-requests').set(bearer(token))
    expect(requests.body.total).toBe(0)
  })

  it('tham số công cụ hỏng hay công cụ lạ thì báo lỗi cho model, lượt vẫn trả lời được', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'x', name: 'search_products', arguments: '{hỏng' }, call('delete_order')] },
      { content: 'Mình chưa tìm được.' },
    ])
    const { request } = await chatShop(llm)
    expect((await ask(request, 'Tìm giày')).body.outcome).toBe('answered')
    expect(toolOutputs(llm, 1)).toEqual([{ error: expect.any(String) }, { error: expect.any(String) }])
  })
})
