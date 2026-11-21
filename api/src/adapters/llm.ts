import { z } from 'zod'

// Gọi model chat qua chuẩn chat completions kiểu OpenAI, đi lần lượt qua một chuỗi model miễn phí (ADR 0017).
// Không dùng parameter properties hay enum: `scripts/chatbot-check.ts` import file này chạy thẳng bằng node.

export type LlmToolCall = { id: string; name: string; arguments: string }

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export type LlmTool = { name: string; description: string; parameters: Record<string, unknown> }

export type LlmRequest = { messages: LlmMessage[]; tools?: LlmTool[] }

export type LlmResult = {
  content: string
  toolCalls: LlmToolCall[]
  usage: { input: number; output: number }
  /** Model đã trả lời, dạng `nhà cung cấp:model`. */
  model: string
  /** Mọi model đã thử hay bỏ qua trong lần gọi này, kể cả model trả lời ở cuối, để ghi báo cáo. */
  attempts: LlmAttempt[]
}

/** Một lần gọi model thất bại trên cả chuỗi. Mỗi model đã thử hay bỏ qua có trong `attempts`, để ghi báo cáo. */
export class LlmUnavailableError extends Error {
  /** `exhausted`: mọi model đang hết hạn mức; `failed`: có model lỗi khác 429. */
  readonly reason: 'exhausted' | 'failed'
  readonly attempts: LlmAttempt[]

  constructor(reason: 'exhausted' | 'failed', attempts: LlmAttempt[]) {
    super(reason === 'exhausted' ? 'Mọi model đang hết hạn mức' : 'Không model nào trả lời được')
    this.name = 'LlmUnavailableError'
    this.reason = reason
    this.attempts = attempts
  }
}

export type LlmAttempt = { model: string; outcome: 'ok' | 'rate_limited' | 'error' | 'skipped'; detail?: string }

export type LlmModelStatus = { model: string; exhaustedUntil: Date | null }

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResult>
  /** Từng model của chuỗi và lúc hết bị đánh dấu đang hết (nếu có). */
  status(): LlmModelStatus[]
}

const PROVIDERS = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', timeoutMs: 20_000 },
  // Model miễn phí của OpenRouter chậm (bản thử: 2–14 giây mỗi tin).
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', timeoutMs: 30_000 },
} as const

type ProviderName = keyof typeof PROVIDERS

export const DEFAULT_LLM_CHAIN =
  'groq:openai/gpt-oss-120b,groq:qwen/qwen3.8-27b,openrouter:nvidia/nemotron-3-ultra-550b-a55b:free'

/** 429 không kèm `retry-after` (OpenRouter khi nhà cung cấp gốc hết hạn mức chung): bỏ qua model trong chừng này. */
const DEFAULT_RETRY_AFTER_MS = 60_000
const MAX_OUTPUT_TOKENS = 1024

export type LlmEndpoint = {
  provider: ProviderName
  model: string
  baseUrl: string
  apiKey: string
  timeoutMs: number
}

const ChatResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string().nullish() }) }),
            )
            .nullish(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).nullish(),
})

function toWireMessage(message: LlmMessage) {
  switch (message.role) {
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      }
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
    default:
      return message
  }
}

function requestBody(endpoint: LlmEndpoint, request: LlmRequest) {
  return {
    model: endpoint.model,
    max_tokens: MAX_OUTPUT_TOKENS,
    // gpt-oss suy luận dài nếu để mặc định; mức thấp đủ cho tư vấn và tiết kiệm token (ADR 0017).
    ...(endpoint.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}),
    messages: request.messages.map(toWireMessage),
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({ type: 'function', function: tool })),
          tool_choice: 'auto',
        }
      : {}),
  }
}

/** `retry-after` tính bằng giây; dạng khác hay thiếu thì dùng mặc định. */
function retryAfterMs(header: string | null) {
  const seconds = Number(header)
  return header && Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : DEFAULT_RETRY_AFTER_MS
}

type Fetch = typeof fetch

/**
 * Chuỗi model: gọi model đầu chưa bị đánh dấu đang hết; 429, 5xx, quá thời gian chờ hay trả lời hỏng thì gọi ngay model
 * kế tiếp. Model trả 429 bị bỏ qua tới hết `retry-after`. Trạng thái đó chỉ nằm trong bộ nhớ process: khởi động lại thì
 * gọi thử lại từ đầu, tốn một lần 429.
 */
export class LlmChain implements LlmClient {
  readonly endpoints: readonly LlmEndpoint[]
  private readonly fetchFn: Fetch
  private readonly now: () => number
  private readonly exhaustedUntil = new Map<string, number>()

  constructor(endpoints: readonly LlmEndpoint[], options: { fetch?: Fetch; now?: () => number } = {}) {
    if (endpoints.length === 0) throw new Error('Chuỗi model rỗng')
    this.endpoints = endpoints
    this.fetchFn = options.fetch ?? fetch
    this.now = options.now ?? Date.now
  }

  status(): LlmModelStatus[] {
    return this.endpoints.map((endpoint) => {
      const until = this.exhaustedUntil.get(nameOf(endpoint))
      return { model: nameOf(endpoint), exhaustedUntil: until && until > this.now() ? new Date(until) : null }
    })
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const attempts: LlmAttempt[] = []
    for (const endpoint of this.endpoints) {
      const model = nameOf(endpoint)
      const until = this.exhaustedUntil.get(model)
      if (until && until > this.now()) {
        attempts.push({ model, outcome: 'skipped' })
        continue
      }
      const outcome = await this.call(endpoint, request)
      if (outcome.kind === 'ok') {
        this.exhaustedUntil.delete(model)
        attempts.push({ model, outcome: 'ok' })
        return { ...outcome.result, attempts }
      }
      if (outcome.kind === 'rate_limited') this.exhaustedUntil.set(model, this.now() + outcome.retryAfterMs)
      attempts.push({ model, outcome: outcome.kind, detail: outcome.detail })
    }
    const failed = attempts.some((attempt) => attempt.outcome === 'error')
    throw new LlmUnavailableError(failed ? 'failed' : 'exhausted', attempts)
  }

  private async call(
    endpoint: LlmEndpoint,
    request: LlmRequest,
  ): Promise<
    | { kind: 'ok'; result: Omit<LlmResult, 'attempts'> }
    | { kind: 'rate_limited'; retryAfterMs: number; detail: string }
    | { kind: 'error'; detail: string }
  > {
    let res: Response
    try {
      res = await this.fetchFn(`${endpoint.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${endpoint.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody(endpoint, request)),
        signal: AbortSignal.timeout(endpoint.timeoutMs),
      })
    } catch (error) {
      return { kind: 'error', detail: error instanceof Error ? error.message : String(error) }
    }
    if (res.status === 429) {
      return { kind: 'rate_limited', retryAfterMs: retryAfterMs(res.headers.get('retry-after')), detail: '429' }
    }
    // Lỗi khác (5xx, model bị gỡ khỏi gói miễn phí, 400) cũng chuyển sang model sau, nhưng không đánh dấu đang hết.
    if (!res.ok) return { kind: 'error', detail: `${res.status}: ${(await res.text()).slice(0, 300)}` }
    const parsed = ChatResponse.safeParse(await res.json().catch(() => null))
    if (!parsed.success) return { kind: 'error', detail: 'Trả lời không đúng định dạng' }
    const message = parsed.data.choices[0]!.message
    const toolCalls = (message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: call.function.arguments ?? '{}',
    }))
    const content = message.content?.trim() ?? ''
    if (!content && toolCalls.length === 0) return { kind: 'error', detail: 'Trả lời rỗng' }
    return {
      kind: 'ok',
      result: {
        content,
        toolCalls,
        usage: { input: parsed.data.usage?.prompt_tokens ?? 0, output: parsed.data.usage?.completion_tokens ?? 0 },
        model: nameOf(endpoint),
      },
    }
  }
}

function nameOf(endpoint: LlmEndpoint) {
  return `${endpoint.provider}:${endpoint.model}`
}

/**
 * Đọc `LLM_CHAIN` (mặc định `DEFAULT_LLM_CHAIN`): danh sách `nhà cung cấp:model` ngăn bằng dấu phẩy. Model của nhà
 * cung cấp thiếu khóa bị bỏ khỏi chuỗi; khóa để trống coi như chưa đặt. Không còn model nào thì trả `[]`: chatbot coi
 * như tắt. Nhà cung cấp lạ là cấu hình sai, nên ném.
 */
export function llmEndpointsFromEnv(env: NodeJS.ProcessEnv): LlmEndpoint[] {
  const chain = env.LLM_CHAIN?.trim() || DEFAULT_LLM_CHAIN
  return chain
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const separator = entry.indexOf(':')
      const provider = entry.slice(0, separator)
      const model = entry.slice(separator + 1)
      if (separator <= 0 || !model) throw new Error(`LLM_CHAIN có mục sai dạng: ${entry}`)
      if (!(provider in PROVIDERS)) throw new Error(`LLM_CHAIN có nhà cung cấp lạ: ${provider}`)
      const config = PROVIDERS[provider as ProviderName]
      const apiKey = env[config.keyEnv]?.trim()
      if (!apiKey) return []
      return [
        { provider: provider as ProviderName, model, baseUrl: config.baseUrl, apiKey, timeoutMs: config.timeoutMs },
      ]
    })
}

/**
 * Model giả cho test và E2E: trả lần lượt các kết quả xếp sẵn; hết kịch bản thì lặp lại tin cuối của khách. Phần tử là
 * `Error` thì ném lỗi đó.
 */
export class ScriptedLlm implements LlmClient {
  readonly requests: LlmRequest[] = []
  private readonly script: (Partial<LlmResult> | Error)[]

  constructor(script: (Partial<LlmResult> | Error)[] = []) {
    this.script = [...script]
  }

  push(...steps: (Partial<LlmResult> | Error)[]) {
    this.script.push(...steps)
  }

  status(): LlmModelStatus[] {
    return [{ model: 'fake:scripted', exhaustedUntil: null }]
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    this.requests.push(request)
    const step = this.script.shift()
    if (step instanceof Error) throw step
    const lastUser = request.messages.findLast((message) => message.role === 'user')
    return {
      content: step ? (step.content ?? '') : `Trợ lý thử: ${lastUser?.content ?? ''}`,
      toolCalls: step?.toolCalls ?? [],
      usage: step?.usage ?? { input: 0, output: 0 },
      model: step?.model ?? 'fake:scripted',
      attempts: step?.attempts ?? [{ model: step?.model ?? 'fake:scripted', outcome: 'ok' }],
    }
  }
}

/**
 * Chọn model cho chatbot: `LLM_CHAIN=fake` dùng `ScriptedLlm` (E2E, không gọi mạng); còn lại dùng `LlmChain` theo khóa
 * đã đặt. Không có khóa nào thì `undefined`: chatbot không trả lời được.
 */
export function llmFromEnv(env: NodeJS.ProcessEnv): LlmClient | undefined {
  if (env.LLM_CHAIN?.trim() === 'fake') return new ScriptedLlm()
  const endpoints = llmEndpointsFromEnv(env)
  return endpoints.length > 0 ? new LlmChain(endpoints) : undefined
}
