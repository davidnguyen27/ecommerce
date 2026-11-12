import { AuthTokens } from '@ecommerce/shared'

type FetchOptions = NonNullable<Parameters<typeof $fetch>[1]>

const WEB_CLIENT = { 'X-Client': 'web' }

/**
 * Phiên của một miền xác thực (ADR 0001) ở trình duyệt: access token chỉ nằm trong bộ nhớ, refresh token nằm trong
 * cookie httpOnly mà `authBase/refresh` đổi lấy access token mới. Gọi ở phạm vi module nên trạng thái dùng chung;
 * chỉ được ghi trong handler chạy ở trình duyệt, vì trên server nó dùng chung cho mọi request.
 */
export function createTokenSession(authBase: string) {
  const accessToken = ref<string | null>(null)
  let refreshing: Promise<boolean> | null = null

  /** Đổi cookie refresh lấy access token mới. Nhiều lời gọi cùng lúc chỉ refresh một lần. */
  function refresh(): Promise<boolean> {
    refreshing ??= $fetch(`${authBase}/refresh`, { method: 'POST', headers: WEB_CLIENT })
      .then((body) => {
        accessToken.value = AuthTokens.parse(body).accessToken
        return true
      })
      .catch(() => {
        accessToken.value = null
        return false
      })
      .finally(() => {
        refreshing = null
      })
    return refreshing
  }

  /** Gửi tới `authBase/path` (đăng nhập, đăng ký) và giữ access token trả về. */
  async function start(path: string, body: Record<string, unknown>) {
    accept(await $fetch(`${authBase}${path}`, { method: 'POST', headers: WEB_CLIENT, body }))
  }

  /** Giữ access token từ một response cấp phiên mới (ví dụ sau khi đổi mật khẩu). */
  function accept(body: unknown) {
    accessToken.value = AuthTokens.parse(body).accessToken
  }

  async function end() {
    await $fetch(`${authBase}/refresh`, { method: 'DELETE', headers: WEB_CLIENT }).catch(() => {})
    accessToken.value = null
  }

  /** Gọi API kèm access token; gặp 401 thì refresh rồi thử lại một lần, refresh không được thì ném lỗi 401. */
  async function authorizedFetch(path: string, options: FetchOptions = {}): Promise<unknown> {
    const send = () =>
      $fetch(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessToken.value}` } })
    try {
      return await send()
    } catch (error) {
      if (!isUnauthorized(error) || !(await refresh())) throw error
      return send()
    }
  }

  return { accessToken: readonly(accessToken), refresh, start, accept, end, authorizedFetch, webClient: WEB_CLIENT }
}

export const isUnauthorized = (error: unknown) => (error as { status?: number }).status === 401
