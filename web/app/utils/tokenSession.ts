import { AuthTokens } from '@ecommerce/shared'

type FetchOptions = NonNullable<Parameters<typeof $fetch>[1]>

const WEB_CLIENT = { 'X-Client': 'web' }

/**
 * Browser session of one auth domain (ADR 0001): the access token lives only in memory, the refresh token in an
 * httpOnly cookie that `authBase/refresh` exchanges for a new access token. Called at module scope, so state is shared;
 * only write it in handlers running in the browser, since on the server it is shared by every request.
 */
export function createTokenSession(authBase: string) {
  const accessToken = ref<string | null>(null)
  let refreshing: Promise<boolean> | null = null

  /** Exchanges the refresh cookie for a new access token. Concurrent calls refresh once. */
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

  /** Posts to `authBase/path` (sign-in, sign-up) and keeps the returned access token. */
  async function start(path: string, body: Record<string, unknown>) {
    accept(await $fetch(`${authBase}${path}`, { method: 'POST', headers: WEB_CLIENT, body }))
  }

  /** Keeps the access token from a response that opens a new session (e.g. after a password change). */
  function accept(body: unknown) {
    accessToken.value = AuthTokens.parse(body).accessToken
  }

  async function end() {
    await $fetch(`${authBase}/refresh`, { method: 'DELETE', headers: WEB_CLIENT }).catch(() => {})
    accessToken.value = null
  }

  /** Calls the API with the access token; on 401 refreshes and retries once, and throws 401 if refresh fails. */
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
