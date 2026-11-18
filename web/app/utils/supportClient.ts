import {
  ExchangeOptions,
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
  /** Tải một ảnh vào tin `messageId` của chính khách (gửi tin trước, rồi tải ảnh). */
  attach: (code: number, messageId: string, file: File) => Promise<PublicSupportRequest>
  /** Biến thể đổi được của từng dòng đơn (form đổi hàng). Tài khoản khách cần `orderCode`. */
  exchangeOptions: (orderCode?: number) => Promise<ExchangeOptions>
  /** Đường dẫn trang chi tiết một yêu cầu. */
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

/** Tải lần lượt `files` vào một tin; trả yêu cầu mới nhất và lỗi đầu tiên (nếu có) để báo cho người gửi. */
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
