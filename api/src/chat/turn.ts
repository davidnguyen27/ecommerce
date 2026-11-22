import type { ProductCard } from '@ecommerce/shared'
import { LlmUnavailableError, type LlmAttempt, type LlmClient, type LlmMessage } from '../adapters/llm.ts'
import type { ModelUsage } from './chat.ts'
import { suggestsSize } from './intent.ts'
import { isLanguageReminder } from './prompt.ts'
import { CHAT_TOOLS, runTool, type ToolDeps } from './tools.ts'

/** Số vòng gọi công cụ tối đa mỗi lượt; sau đó gọi một lần không kèm công cụ để buộc trả lời (spec M8). */
export const MAX_TOOL_ROUNDS = 3

/** Một lần gọi model trong lượt, để ghi `chat_usage_day`. */
export type TurnCall = { attempts: LlmAttempt[]; usage: ModelUsage | null }

export type TurnResult = {
  content: string
  model: string
  /** Thẻ các sản phẩm đã tìm trong lượt, mỗi sản phẩm một lần, theo thứ tự tìm thấy. */
  cards: ProductCard[]
  handoffSummary: string | null
  calls: TurnCall[]
  /** Công cụ đã gọi kèm tham số, theo thứ tự, để ghi log. */
  tools: { name: string; arguments: string }[]
}

/** Lượt không có câu trả lời. `calls` gồm cả các lần gọi đã thành công trước đó, để vẫn ghi đủ lượt gọi. */
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

/** Chạy một lượt: gọi model, chạy công cụ model yêu cầu, gửi kết quả lại, tới khi model trả lời bằng chữ. */
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

    // Chỉ giữ một lời nhắc ngôn ngữ, luôn ở cuối: nhiều system message xen giữa làm gpt-oss viết ra chữ vô nghĩa
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
    // Kết quả công cụ là tiếng Việt; lời nhắc đứng trước chúng thì khách hỏi tiếng Anh vẫn nhận câu trả lời tiếng Việt.
    if (reminder) messages.push(reminder)
  }
}

/** Viết lại khi model đoán size cho sản phẩm không có bảng size. Lời nhắc đặt sau câu trả lời cần viết lại. */
const NO_SIZE_CHART_REWRITE =
  'The reply above suggests a size, but the product has no size chart. Rewrite it: say the product has no size chart and suggest no size, not even a usual one; keep every other fact, price and link; never mention field names such as sizeChart.'

/**
 * Các sản phẩm model đã xem trong lượt (kết quả `get_product`, kể cả sản phẩm đang xem dựng sẵn) đều không có bảng size,
 * mà câu trả lời vẫn gợi ý size. Prompt đã cấm, nhưng gpt-oss vẫn đoán theo kiến thức chung khoảng 1/3 số lần
 * (chatbot-check 2026-11-21); spec M8: không có bảng size thì nói thẳng, không đoán.
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

/** Gọi model thêm một lần, không kèm công cụ, để viết lại câu trả lời. Lỗi thì giữ câu trả lời cũ. */
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
