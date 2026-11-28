import type { ProductCard } from '@ecommerce/shared'
import { LlmUnavailableError, type LlmAttempt, type LlmClient, type LlmMessage } from '../core/adapters/llm.ts'
import type { ModelUsage } from './chat.ts'
import { suggestsSize } from './intent.ts'
import { isLanguageReminder } from './prompt.ts'
import { CHAT_TOOLS, runTool, type ToolDeps } from './tools.ts'

/** Max tool rounds per turn; then one call without tools forces an answer (spec M8). */
export const MAX_TOOL_ROUNDS = 3

/** One model call in the turn, for `chat_usage_day`. */
export type TurnCall = { attempts: LlmAttempt[]; usage: ModelUsage | null }

export type TurnResult = {
  content: string
  model: string
  /** Cards of products found in the turn, each once, in order found. */
  cards: ProductCard[]
  handoffSummary: string | null
  calls: TurnCall[]
  /** Tools called with arguments, in order, for logging. */
  tools: { name: string; arguments: string }[]
}

/** A turn without an answer. `calls` includes earlier successful calls, so usage is still recorded in full. */
export class TurnFailedError extends Error {
  readonly reason: LlmUnavailableError['reason']
  readonly calls: TurnCall[]
  readonly cause: unknown

  constructor(reason: LlmUnavailableError['reason'], calls: TurnCall[], cause: unknown) {
    super('Chatbot không trả lời được')
    this.name = 'TurnFailedError'
    this.reason = reason
    this.calls = calls
    this.cause = cause
  }
}

/** Runs one turn: call the model, run requested tools, send results back, until the model answers in text. */
export async function runTurn(llm: LlmClient, deps: ToolDeps, prompt: LlmMessage[]): Promise<TurnResult> {
  const messages = [...prompt]
  const reminder = isLanguageReminder(prompt.at(-1)) ? prompt.at(-1) : undefined
  const calls: TurnCall[] = []
  const cards = new Map<string, ProductCard>()
  let handoffSummary: string | null = null
  const tools: TurnResult['tools'] = []

  for (let round = 0; ; round++) {
    const withTools = round < MAX_TOOL_ROUNDS
    let result
    try {
      result = await llm.complete({ messages, tools: withTools ? CHAT_TOOLS : undefined })
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        throw new TurnFailedError(error.reason, [...calls, { attempts: error.attempts, usage: null }], error)
      }
      throw new TurnFailedError('failed', calls, error)
    }
    calls.push({ attempts: result.attempts, usage: { model: result.model, ...result.usage } })
    if (!withTools || result.toolCalls.length === 0) {
      const answer = guessesSizeWithoutChart(messages, result.content)
        ? await rewriteWithoutSize(llm, messages, result, reminder, calls)
        : result
      return { content: answer.content, model: answer.model, cards: [...cards.values()], handoffSummary, calls, tools }
    }

    // Keep one language reminder, always last: several system messages in between made gpt-oss write gibberish
    // (chatbot-check 2026-11-21).
    if (isLanguageReminder(messages.at(-1))) messages.pop()
    messages.push({ role: 'assistant', content: result.content, toolCalls: result.toolCalls })
    for (const call of result.toolCalls) {
      tools.push({ name: call.name, arguments: call.arguments })
      const outcome = await runTool(deps, call)
      for (const card of outcome.cards ?? []) if (!cards.has(card.slug)) cards.set(card.slug, card)
      if (outcome.handoffSummary) handoffSummary = outcome.handoffSummary
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(outcome.output) })
    }
    // Tool results are Vietnamese; a reminder placed before them got Vietnamese answers to English questions.
    if (reminder) messages.push(reminder)
  }
}

/** Rewrite when the model guessed a size for a product without a size chart. The reminder goes after the answer. */
const NO_SIZE_CHART_REWRITE =
  'The reply above suggests a size, but the product has no size chart. Rewrite it: say the product has no size chart and suggest no size, not even a usual one; keep every other fact, price and link; never mention field names such as sizeChart.'

/**
 * None of the products the model saw this turn (`get_product` results, the prebuilt viewed product included) has a
 * size chart, yet the answer suggests a size. The prompt forbids it, but gpt-oss still guessed about 1/3 of the time
 * (chatbot-check 2026-11-21); spec M8: without a size chart, say so and do not guess.
 */
function guessesSizeWithoutChart(messages: readonly LlmMessage[], content: string) {
  const charts = messages.flatMap((message) => {
    if (message.role !== 'tool') return []
    try {
      const output: unknown = JSON.parse(message.content)
      return output && typeof output === 'object' && 'sizeChart' in output ? [output.sizeChart] : []
    } catch {
      return []
    }
  })
  return charts.length > 0 && charts.every((chart) => chart === 'none') && suggestsSize(content)
}

/** One extra call without tools to rewrite the answer. On error the old answer is kept. */
async function rewriteWithoutSize(
  llm: LlmClient,
  messages: readonly LlmMessage[],
  previous: { content: string; model: string },
  reminder: LlmMessage | undefined,
  calls: TurnCall[],
) {
  try {
    const rewritten = await llm.complete({
      messages: [
        ...messages.filter((message) => !isLanguageReminder(message)),
        { role: 'assistant', content: previous.content },
        { role: 'system', content: NO_SIZE_CHART_REWRITE },
        ...(reminder ? [reminder] : []),
      ],
    })
    calls.push({ attempts: rewritten.attempts, usage: { model: rewritten.model, ...rewritten.usage } })
    return rewritten
  } catch (error) {
    if (error instanceof LlmUnavailableError) calls.push({ attempts: error.attempts, usage: null })
    return previous
  }
}
