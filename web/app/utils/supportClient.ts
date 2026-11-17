import {
  PublicSupportList,
  PublicSupportRequest,
  type CreateSupportRequest,
  type PublicSupportSummary,
} from '@ecommerce/shared'

/**
 * Gọi API yêu cầu hỗ trợ của khách theo một trong hai đường (spec M6b): tài khoản đang đăng nhập, hoặc link tra cứu đơn
 * có token. Component chỉ làm việc với client này nên dùng chung được cho cả hai trang.
 */
export type SupportClient = {
  list: () => Promise<PublicSupportSummary[]>
  create: (body: CreateSupportRequest) => Promise<PublicSupportRequest>
  get: (code: number) => Promise<PublicSupportRequest>
  say: (code: number, message: string) => Promise<PublicSupportRequest>
  /** Đường dẫn trang chi tiết một yêu cầu. */
  linkTo: (code: number) => string
}

type Fetch = (path: string, options?: { method?: 'POST'; body?: Record<string, unknown> }) => Promise<unknown>

function clientOf(base: string, call: Fetch, linkTo: (code: number) => string): SupportClient {
  return {
    list: async () => PublicSupportList.parse(await call(base)).items,
    create: async (body) => PublicSupportRequest.parse(await call(base, { method: 'POST', body: { ...body } })),
    get: async (code) => PublicSupportRequest.parse(await call(`${base}/${code}`)),
    say: async (code, message) =>
      PublicSupportRequest.parse(await call(`${base}/${code}/messages`, { method: 'POST', body: { message } })),
    linkTo,
  }
}

/** Yêu cầu của khách đang đăng nhập; `accountFetch` gắn token phiên. */
export function accountSupportClient(accountFetch: Fetch) {
  return clientOf('/api/account/support-requests', accountFetch, (code) => `/tai-khoan/yeu-cau/${code}`)
}

/** Yêu cầu của một đơn qua link tra cứu: mọi lời gọi kèm token của đơn. */
export function guestSupportClient(orderCode: number, token: string) {
  // Ép về kiểu hàm thường: kiểu route của `$fetch` quá sâu với đường dẫn ghép chuỗi (TypeScript báo tràn đệ quy).
  const request = $fetch as unknown as (url: string, options: Record<string, unknown>) => Promise<unknown>
  const call: Fetch = (path, options) => request(path, { ...options, query: { token } })
  return clientOf(
    `/api/orders/${orderCode}/support-requests`,
    call,
    (code) => `/yeu-cau/${code}?don=${orderCode}&token=${encodeURIComponent(token)}`,
  )
}
