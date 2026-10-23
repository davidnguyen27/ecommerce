import { AuthTokens, CustomerProfile, type RegisterRequest } from '@ecommerce/shared'

// Phiên khách chỉ sống ở trình duyệt: cookie refresh chỉ gửi tới `/api/auth/refresh`, nên server Nuxt
// không bao giờ biết khách là ai. Biến module này chỉ được ghi trong handler chạy ở trình duyệt,
// vì trên server nó dùng chung cho mọi request.
const accessToken = ref<string | null>(null)
let refreshing: Promise<boolean> | null = null

const AUTH = '/api/auth'
const WEB_CLIENT = { 'X-Client': 'web' }

/** Đổi cookie refresh lấy access token mới. Nhiều lời gọi cùng lúc chỉ refresh một lần. */
function refresh(): Promise<boolean> {
  refreshing ??= $fetch(`${AUTH}/refresh`, { method: 'POST', headers: WEB_CLIENT })
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

async function login(email: string, password: string) {
  const body = await $fetch(`${AUTH}/login`, { method: 'POST', headers: WEB_CLIENT, body: { email, password } })
  accessToken.value = AuthTokens.parse(body).accessToken
}

async function register(input: RegisterRequest) {
  const body = await $fetch(`${AUTH}/register`, { method: 'POST', headers: WEB_CLIENT, body: input })
  accessToken.value = AuthTokens.parse(body).accessToken
}

async function logout() {
  await $fetch(`${AUTH}/refresh`, { method: 'DELETE', headers: WEB_CLIENT }).catch(() => {})
  accessToken.value = null
  await navigateTo('/dang-nhap')
}

type FetchOptions = NonNullable<Parameters<typeof $fetch>[1]>

/** Gọi `/api/account/*` kèm access token; chưa có hoặc hết hạn thì refresh rồi thử lại một lần. */
async function accountFetch(path: string, options: FetchOptions = {}): Promise<unknown> {
  const send = () =>
    $fetch(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessToken.value}` } })
  if (accessToken.value === null && !(await refresh())) throw new Error('Chưa đăng nhập')
  try {
    return await send()
  } catch (error) {
    if ((error as { status?: number }).status !== 401 || !(await refresh())) throw error
    return send()
  }
}

async function loadProfile(): Promise<CustomerProfile> {
  return CustomerProfile.parse(await accountFetch('/api/account/me'))
}

export function useCustomerSession() {
  return { refresh, login, register, logout, accountFetch, loadProfile }
}
