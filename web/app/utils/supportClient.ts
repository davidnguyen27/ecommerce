import {
  ExchangeOptions,
  PublicSupportList,
  PublicSupportRequest,
  type CreateSupportRequest,
  type PublicSupportSummary,
} from '@ecommerce/shared'

/**
 * Calls the customer support request API through one of two paths (spec M6b): the signed-in account, or an order
 * lookup link with a token. Components only use this client, so they work on both pages.
 */
export type SupportClient = {
  list: () => Promise<PublicSupportSummary[]>
  create: (body: CreateSupportRequest) => Promise<PublicSupportRequest>
  get: (code: number) => Promise<PublicSupportRequest>
  say: (code: number, message: string) => Promise<PublicSupportRequest>
  /** Uploads an image to the customer's own message `messageId` (send the message first, then upload). */
  attach: (code: number, messageId: string, file: File) => Promise<PublicSupportRequest>
  /** Exchangeable variants per order line (exchange form). Accounts need `orderCode`. */
  exchangeOptions: (orderCode?: number) => Promise<ExchangeOptions>
  /** Path of a request's detail page. */
  linkTo: (code: number) => string
}

type Fetch = (
  path: string,
  options?: { method?: 'POST'; body?: Record<string, unknown> | FormData },
) => Promise<unknown>

function clientOf(base: string, call: Fetch, linkTo: (code: number) => string): SupportClient {
  return {
    list: async () => PublicSupportList.parse(await call(base)).items,
    create: async (body) => PublicSupportRequest.parse(await call(base, { method: 'POST', body: { ...body } })),
    get: async (code) => PublicSupportRequest.parse(await call(`${base}/${code}`)),
    say: async (code, message) =>
      PublicSupportRequest.parse(await call(`${base}/${code}/messages`, { method: 'POST', body: { message } })),
    attach: async (code, messageId, file) => {
      const body = new FormData()
      body.append('file', file)
      return PublicSupportRequest.parse(
        await call(`${base}/${code}/messages/${messageId}/attachments`, { method: 'POST', body }),
      )
    },
    exchangeOptions: async (orderCode) =>
      ExchangeOptions.parse(
        await call(
          orderCode === undefined ? base + '/exchange-options' : base + '/exchange-options' + '?orderCode=' + orderCode,
        ),
      ),
    linkTo,
  }
}

/** Requests of the signed-in customer; `accountFetch` adds the session token. */
export function accountSupportClient(accountFetch: Fetch) {
  return clientOf('/api/account/support-requests', accountFetch, (code) => `/tai-khoan/yeu-cau/${code}`)
}

/** Requests of one order via a lookup link: every call carries the order token. */
export function guestSupportClient(orderCode: number, token: string) {
  // Cast to a plain function type: `$fetch`'s route typing goes too deep with concatenated paths (TypeScript recursion
  // limit).
  const request = $fetch as unknown as (url: string, options: Record<string, unknown>) => Promise<unknown>
  const call: Fetch = (path, options) => request(path, { ...options, query: { token } })
  return clientOf(
    `/api/orders/${orderCode}/support-requests`,
    call,
    (code) => `/yeu-cau/${code}?don=${orderCode}&token=${encodeURIComponent(token)}`,
  )
}

/** Requests without an order (chatbot handoff, M8) via the email link: every call carries the request token. */
export function contactSupportClient(token: string) {
  const request = $fetch as unknown as (url: string, options: Record<string, unknown>) => Promise<unknown>
  const call: Fetch = (path, options) => request(path, { ...options, query: { token } })
  return clientOf('/api/support-requests', call, (code) => `/yeu-cau/${code}?token=${encodeURIComponent(token)}`)
}

/** Uploads `files` to a message one by one; returns the latest request and the first error (if any) to report. */
export async function attachAll<T>(
  attach: (file: File) => Promise<T>,
  files: readonly File[],
): Promise<{ request: T | null; error: string | null }> {
  let request: T | null = null
  for (const file of files) {
    try {
      request = await attach(file)
    } catch (err) {
      return { request, error: `Không gửi được ảnh ${file.name}: ${apiErrorMessage(err)}` }
    }
  }
  return { request, error: null }
}
