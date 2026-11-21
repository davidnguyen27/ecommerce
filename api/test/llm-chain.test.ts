import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LLM_CHAIN,
  DemoLlm,
  LlmChain,
  LlmUnavailableError,
  ScriptedLlm,
  llmEndpointsFromEnv,
  llmFromEnv,
  type LlmRequest,
} from '../src/adapters/llm.ts'

// Chuỗi model chưa có route nào dùng (ticket 02 mới có API chat), và không được gọi nhà cung cấp thật trong test:
// gọi thẳng `LlmChain` với `fetch` giả trả lời theo từng model.

const KEYS = { GROQ_API_KEY: 'gsk_test', OPENROUTER_API_KEY: 'sk-or-test' }
const REQUEST: LlmRequest = { messages: [{ role: 'user', content: 'Có túi đen dưới 5 triệu không?' }] }

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error

function okReply(content: string, extra: Record<string, unknown> = {}): Reply {
  return {
    status: 200,
    body: {
      choices: [{ message: { content, ...extra } }],
      usage: { prompt_tokens: 650, completion_tokens: 60 },
    },
  }
}

/** `fetch` giả: mỗi model có hàng đợi trả lời riêng; ghi lại model và body của từng lần gọi. */
function fakeFetch(replies: Record<string, Reply[]>) {
  const calls: { model: string; body: Record<string, unknown>; auth: string | null }[] = []
  const fn: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    const model = String(body.model)
    calls.push({ model, body, auth: new Headers(init?.headers).get('authorization') })
    const reply = replies[model]?.shift()
    if (!reply) throw new Error(`Không có trả lời giả cho ${model}`)
    if (reply instanceof Error) throw reply
    return new Response(JSON.stringify(reply.body ?? { error: 'lỗi' }), {
      status: reply.status,
      headers: reply.headers,
    })
  }
  return { fn, calls }
}

function chain(replies: Record<string, Reply[]>, env: NodeJS.ProcessEnv = KEYS) {
  let now = Date.UTC(2026, 10, 21, 3)
  const fetch = fakeFetch(replies)
  const llm = new LlmChain(llmEndpointsFromEnv(env), { fetch: fetch.fn, now: () => now })
  return { llm, calls: fetch.calls, advance: (ms: number) => (now += ms) }
}

describe('đọc chuỗi model từ biến môi trường', () => {
  it('mặc định là hai model Groq rồi Nemotron của OpenRouter, mỗi nhà cung cấp dùng khóa của mình', () => {
    const endpoints = llmEndpointsFromEnv(KEYS)
    expect(endpoints.map((e) => `${e.provider}:${e.model}`).join(',')).toBe(DEFAULT_LLM_CHAIN)
    expect(endpoints.map((e) => e.apiKey)).toEqual(['gsk_test', 'gsk_test', 'sk-or-test'])
  })

  it('thiếu khóa OpenRouter thì chuỗi chỉ còn hai model Groq; khóa để trống coi như thiếu', () => {
    const endpoints = llmEndpointsFromEnv({ ...KEYS, OPENROUTER_API_KEY: '  ' })
    expect(endpoints.map((e) => e.model)).toEqual(['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'])
  })

  it('không có khóa nào thì chatbot không có model; LLM_CHAIN=fake dùng model giả', () => {
    expect(llmFromEnv({})).toBeUndefined()
    expect(llmFromEnv({ LLM_CHAIN: 'fake' })).toBeInstanceOf(DemoLlm)
    expect(llmFromEnv(KEYS)).toBeInstanceOf(LlmChain)
  })

  it('LLM_CHAIN đặt riêng thứ tự; nhà cung cấp lạ hay mục sai dạng thì báo lỗi', () => {
    const endpoints = llmEndpointsFromEnv({ ...KEYS, LLM_CHAIN: 'openrouter:a/b:free, groq:c/d' })
    expect(endpoints.map((e) => `${e.provider}:${e.model}`)).toEqual(['openrouter:a/b:free', 'groq:c/d'])
    expect(() => llmEndpointsFromEnv({ ...KEYS, LLM_CHAIN: 'gemini:x' })).toThrow('nhà cung cấp lạ: gemini')
    expect(() => llmEndpointsFromEnv({ ...KEYS, LLM_CHAIN: 'groq' })).toThrow('sai dạng')
  })
})

describe('gọi qua chuỗi model', () => {
  it('model đầu trả lời thì dùng luôn; gpt-oss được gửi mức suy luận thấp, kèm công cụ khi có', async () => {
    const { llm, calls } = chain({ 'openai/gpt-oss-120b': [okReply('Có 2 mẫu')] })
    const result = await llm.complete({
      ...REQUEST,
      tools: [{ name: 'search_products', description: 'Tìm', parameters: { type: 'object', properties: {} } }],
    })
    expect(result).toEqual({
      content: 'Có 2 mẫu',
      toolCalls: [],
      usage: { input: 650, output: 60 },
      model: 'groq:openai/gpt-oss-120b',
      attempts: [{ model: 'groq:openai/gpt-oss-120b', outcome: 'ok' }],
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.auth).toBe('Bearer gsk_test')
    expect(calls[0]!.body).toMatchObject({ reasoning_effort: 'low', tool_choice: 'auto' })
  })

  it('đọc lời gọi công cụ, kể cả khi không có chữ', async () => {
    const { llm } = chain({
      'openai/gpt-oss-120b': [
        okReply('', {
          content: null,
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'search_products', arguments: '{"maxPrice":5000000}' } },
          ],
        }),
      ],
    })
    const result = await llm.complete(REQUEST)
    expect(result.toolCalls).toEqual([{ id: 'c1', name: 'search_products', arguments: '{"maxPrice":5000000}' }])
  })

  it('model đầu 429 thì model hai trả lời ngay trong cùng lần gọi; model đầu bị bỏ qua tới hết retry-after', async () => {
    const { llm, calls, advance } = chain({
      'openai/gpt-oss-120b': [{ status: 429, headers: { 'retry-after': '30' } }, okReply('Lại là gpt-oss')],
      'qwen/qwen3.8-27b': [okReply('Qwen trả lời'), okReply('Qwen lần hai')],
    })
    const fallback = await llm.complete(REQUEST)
    expect(fallback.model).toBe('groq:qwen/qwen3.8-27b')
    expect(fallback.attempts.map((a) => a.outcome)).toEqual(['rate_limited', 'ok'])
    expect(llm.status()[0]!.exhaustedUntil).not.toBeNull()

    advance(29_000)
    expect((await llm.complete(REQUEST)).content).toBe('Qwen lần hai')

    advance(2_000)
    expect((await llm.complete(REQUEST)).content).toBe('Lại là gpt-oss')
    expect(llm.status()[0]!.exhaustedUntil).toBeNull()
    expect(calls.map((c) => c.model)).toEqual([
      'openai/gpt-oss-120b',
      'qwen/qwen3.8-27b',
      'qwen/qwen3.8-27b',
      'openai/gpt-oss-120b',
    ])
  })

  it('429 không kèm retry-after thì bỏ qua model 60 giây', async () => {
    const { llm, advance } = chain({
      'openai/gpt-oss-120b': [{ status: 429 }, okReply('gpt-oss')],
      'qwen/qwen3.8-27b': [okReply('qwen'), okReply('qwen')],
    })
    await llm.complete(REQUEST)
    advance(59_000)
    expect((await llm.complete(REQUEST)).content).toBe('qwen')
    advance(1_000)
    expect((await llm.complete(REQUEST)).content).toBe('gpt-oss')
  })

  it('5xx, lỗi mạng hay trả lời rỗng thì chuyển model nhưng không đánh dấu đang hết', async () => {
    const { llm } = chain({
      'openai/gpt-oss-120b': [{ status: 503 }],
      'qwen/qwen3.8-27b': [new TypeError('fetch failed')],
      'nvidia/nemotron-3-ultra-550b-a55b:free': [okReply('   ')],
    })
    const error = await llm.complete(REQUEST).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LlmUnavailableError)
    expect((error as LlmUnavailableError).reason).toBe('failed')
    expect((error as LlmUnavailableError).attempts.map((a) => a.outcome)).toEqual(['error', 'error', 'error'])
    expect(llm.status().every((s) => s.exhaustedUntil === null)).toBe(true)
  })

  it('cả chuỗi 429 thì báo hết lượt, và lần sau không gọi model nào tới khi hết retry-after', async () => {
    const { llm, calls } = chain({
      'openai/gpt-oss-120b': [{ status: 429, headers: { 'retry-after': '3600' } }],
      'qwen/qwen3.8-27b': [{ status: 429, headers: { 'retry-after': '3600' } }],
      'nvidia/nemotron-3-ultra-550b-a55b:free': [{ status: 429 }],
    })
    const first = (await llm.complete(REQUEST).catch((e: unknown) => e)) as LlmUnavailableError
    expect(first.reason).toBe('exhausted')

    const second = (await llm.complete(REQUEST).catch((e: unknown) => e)) as LlmUnavailableError
    expect(second.reason).toBe('exhausted')
    expect(second.attempts.map((a) => a.outcome)).toEqual(['skipped', 'skipped', 'skipped'])
    expect(calls).toHaveLength(3)
  })
})

describe('model giả', () => {
  it('trả theo kịch bản, ném lỗi khi được xếp lỗi, hết kịch bản thì nhắc lại tin cuối của khách', async () => {
    const llm = new ScriptedLlm([{ content: 'Câu một' }, new LlmUnavailableError('exhausted', [])])
    expect((await llm.complete(REQUEST)).content).toBe('Câu một')
    await expect(llm.complete(REQUEST)).rejects.toThrow(LlmUnavailableError)
    expect((await llm.complete(REQUEST)).content).toBe('Trợ lý thử: Có túi đen dưới 5 triệu không?')
    expect(llm.requests).toHaveLength(3)
  })
})

describe('model giả cho E2E', () => {
  it('tin cuối của khách thì tìm sản phẩm bằng câu đó; có kết quả công cụ thì trả lời bằng tên sản phẩm', async () => {
    const llm = new DemoLlm()
    const tools = [{ name: 'search_products', description: 'Tìm', parameters: {} }]
    // Sản phẩm đang xem (API dựng sẵn) là kết quả công cụ khác: vẫn tìm bằng câu của khách.
    const viewing = [
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [{ id: 'viewing_product', name: 'get_product', arguments: '{}' }],
      },
      { role: 'tool' as const, toolCallId: 'viewing_product', content: '{"name":"Áo khác"}' },
    ]
    const search = await llm.complete({ messages: [{ role: 'user', content: 'Air Max' }, ...viewing], tools })
    expect(search.toolCalls).toEqual([{ id: 'demo-search', name: 'search_products', arguments: '{"text":"Air Max"}' }])

    const answer = await llm.complete({
      messages: [
        { role: 'user', content: 'Air Max' },
        ...viewing,
        { role: 'assistant', content: '', toolCalls: search.toolCalls },
        {
          role: 'tool',
          toolCallId: 'demo-search',
          content: '{"products":[{"slug":"air-max-90","name":"Air Max 90"}]}',
        },
        { role: 'system', content: 'nhắc ngôn ngữ' },
      ],
    })
    expect(answer).toMatchObject({ content: 'Mình tìm được: Air Max 90.', toolCalls: [] })
  })
})
