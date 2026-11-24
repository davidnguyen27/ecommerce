import { z } from 'zod'

// Chat model calls via OpenAI-style chat completions, walking a chain of free models (ADR 0017).
// No parameter properties or enums: `scripts/chatbot-check.ts` imports this file under plain node.

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
  /** The model that answered, as `provider:model`. */
  model: string
  /** Every model tried or skipped in this call, including the one that answered, for reporting. */
  attempts: LlmAttempt[]
}

/** A call that failed on the whole chain. `attempts` lists every model tried or skipped, for reporting. */
export class LlmUnavailableError extends Error {
  /** `exhausted`: every model is out of quota; `failed`: some model failed with a non-429 error. */
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
  /** Each model in the chain and when its exhausted mark expires, if any. */
  status(): LlmModelStatus[]
}

const PROVIDERS = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', timeoutMs: 20_000 },
  // OpenRouter free models are slow (trial: 2–14 s per message).
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', timeoutMs: 30_000 },
} as const

type ProviderName = keyof typeof PROVIDERS

export const DEFAULT_LLM_CHAIN =
  'groq:openai/gpt-oss-120b,groq:qwen/qwen3.8-27b,openrouter:nvidia/nemotron-3-ultra-550b-a55b:free'

/** 429 without `retry-after` (OpenRouter when the upstream shared quota runs out): skip the model this long. */
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
    // gpt-oss reasons at length by default (ADR 0017). `low` is cheaper but some contexts make it write gibberish
    // ("**Michael … Sorry… Oops…"): viewing a Coach bag, asking for a cheaper one, 5/5 with `low`, 0/5 with `medium`
    // (demo walkthrough 2026-11-23). A low `temperature` does not fix it.
    ...(endpoint.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'medium' } : {}),
    messages: request.messages.map(toWireMessage),
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({ type: 'function', function: tool })),
          tool_choice: 'auto',
        }
      : {}),
  }
}

/** `retry-after` in seconds; other or missing values use the default. */
function retryAfterMs(header: string | null) {
  const seconds = Number(header)
  return header && Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : DEFAULT_RETRY_AFTER_MS
}

type Fetch = typeof fetch

/**
 * Model chain: calls the first model not marked exhausted; on 429, 5xx, timeout or a broken reply, moves straight to
 * the next. A 429 model is skipped until `retry-after`. That state lives in process memory only: a restart retries
 * from the top at the cost of one 429.
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
    // Other errors (5xx, model dropped from the free tier, 400) also move on, without marking the model exhausted.
    if (!res.ok) return { kind: 'error', detail: `${res.status}: ${(await res.text()).slice(0, 300)}` }
    const parsed = ChatResponse.safeParse(await res.json().catch(() => null))
    if (!parsed.success) return { kind: 'error', detail: 'Trả lời không đúng định dạng' }
    const message = parsed.data.choices[0]!.message
    // No tools were sent (forced answer) but the model called some anyway: drop the calls, nobody runs them.
    const toolCalls = request.tools?.length
      ? (message.tool_calls ?? []).map((call) => ({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments ?? '{}',
        }))
      : []
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
 * Reads `LLM_CHAIN` (default `DEFAULT_LLM_CHAIN`): comma-separated `provider:model`. Models whose provider has no key
 * are dropped; an empty key counts as unset. No models left gives `[]` (chatbot off). An unknown provider throws.
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
 * Fake model for tests and E2E: returns scripted results in order, then echoes the customer's last message. An
 * `Error` entry is thrown.
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

const DEMO_SEARCH_ID = 'demo-search'

/**
 * Fake model for E2E and keyless runs (`LLM_CHAIN=fake`): if nothing was searched since the customer's last message,
 * searches products with that exact text (so ask by product name, e.g. "Air Max"); otherwise answers with the names
 * found. Other tool results (the prebuilt viewed product) do not count. No network, deterministic.
 */
export class DemoLlm implements LlmClient {
  status(): LlmModelStatus[] {
    return [{ model: 'fake:demo', exhaustedUntil: null }]
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const result = (content: string, toolCalls: LlmToolCall[] = []): LlmResult => ({
      content,
      toolCalls,
      usage: { input: 0, output: 0 },
      model: 'fake:demo',
      attempts: [{ model: 'fake:demo', outcome: 'ok' }],
    })
    const askedAt = request.messages.findLastIndex((message) => message.role === 'user')
    const question = request.messages[askedAt]
    const searched = request.messages
      .slice(askedAt + 1)
      .find((message) => message.role === 'tool' && message.toolCallId === DEMO_SEARCH_ID)
    if (searched?.role === 'tool') {
      const found = [...searched.content.matchAll(/"name":"([^"]+)"/g)].map((match) => match[1])
      return result(found.length ? `Mình tìm được: ${found.join(', ')}.` : 'Mình chưa tìm được sản phẩm phù hợp.')
    }
    if (question?.role === 'user' && request.tools?.some((tool) => tool.name === 'search_products')) {
      return result('', [
        { id: DEMO_SEARCH_ID, name: 'search_products', arguments: JSON.stringify({ text: question.content }) },
      ])
    }
    return result('Mình là trợ lý thử.')
  }
}

/**
 * Picks the chatbot model: `LLM_CHAIN=fake` uses `DemoLlm` (E2E, no network); otherwise `LlmChain` from the keys set.
 * No keys gives `undefined`: the chatbot cannot answer.
 */
export function llmFromEnv(env: NodeJS.ProcessEnv): LlmClient | undefined {
  if (env.LLM_CHAIN?.trim() === 'fake') return new DemoLlm()
  const endpoints = llmEndpointsFromEnv(env)
  return endpoints.length > 0 ? new LlmChain(endpoints) : undefined
}
