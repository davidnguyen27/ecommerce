import { AuthTokens, StaffProfile } from '@ecommerce/shared'

// `/admin/**` chỉ chạy ở trình duyệt nên giữ token trong biến module là đủ.
// Access token chỉ nằm trong bộ nhớ; tải lại trang thì lấy lại bằng refresh token trong cookie httpOnly.
const accessToken = ref<string | null>(null)
let refreshing: Promise<boolean> | null = null

const AUTH = '/api/admin/auth'
const WEB_CLIENT = { 'X-Client': 'web' }

/** Đổi cookie refresh lấy access token mới. Nhiều request cùng gặp 401 thì chỉ refresh một lần. */
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

async function logout() {
  await $fetch(`${AUTH}/refresh`, { method: 'DELETE', headers: WEB_CLIENT }).catch(() => {})
  accessToken.value = null
  await navigateTo('/admin/login')
}

/** Gọi `/api/admin/*` kèm access token; hết hạn thì refresh rồi thử lại một lần. */
async function adminFetch(path: string, options: Parameters<typeof $fetch>[1] = {}): Promise<unknown> {
  const send = () =>
    $fetch(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessToken.value}` } })
  try {
    return await send()
  } catch (error) {
    if ((error as { status?: number }).status !== 401) throw error
    if (!(await refresh())) {
      await navigateTo('/admin/login')
      throw error
    }
    return send()
  }
}

async function fetchMe(): Promise<StaffProfile> {
  return StaffProfile.parse(await adminFetch('/api/admin/me'))
}

export function useAdminSession() {
  return { isLoggedIn: computed(() => accessToken.value !== null), refresh, login, logout, fetchMe }
}
