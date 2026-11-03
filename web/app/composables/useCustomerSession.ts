import { CustomerProfile, type ChangePasswordRequest, type RegisterRequest } from '@ecommerce/shared'

// Phiên khách chỉ sống ở trình duyệt: cookie refresh chỉ gửi tới `/api/auth/refresh`, nên server Nuxt
// không bao giờ biết khách là ai.
const tokens = createTokenSession('/api/auth')

const login = (email: string, password: string) => tokens.start('/login', { email, password })

const register = (input: RegisterRequest) => tokens.start('/register', input)

async function logout() {
  await tokens.end()
  await navigateTo('/dang-nhap')
}

/** Gọi `/api/account/*` kèm access token; chưa có thì refresh trước, không được thì coi là chưa đăng nhập. */
async function accountFetch(path: string, options?: Parameters<typeof tokens.authorizedFetch>[1]): Promise<unknown> {
  if (tokens.accessToken.value === null && !(await tokens.refresh())) throw new Error('Chưa đăng nhập')
  return tokens.authorizedFetch(path, options)
}

/** Khách đã đăng nhập chưa; chưa có access token thì thử refresh. Không ném lỗi. */
async function signedIn(): Promise<boolean> {
  return tokens.accessToken.value !== null || tokens.refresh()
}

/** Gọi API mở cho cả khách vãng lai (ví dụ đặt mua): đã đăng nhập thì kèm access token, chưa thì gửi không kèm. */
async function optionalAuthFetch(path: string, options?: Parameters<typeof tokens.authorizedFetch>[1]) {
  return (await signedIn()) ? tokens.authorizedFetch(path, options) : $fetch(path, options)
}

async function loadProfile(): Promise<CustomerProfile> {
  return CustomerProfile.parse(await accountFetch('/api/account/me'))
}

/** Đổi mật khẩu; mọi thiết bị khác bị đăng xuất, trình duyệt này nhận phiên mới. */
async function changePassword(input: ChangePasswordRequest) {
  tokens.accept(await accountFetch('/api/account/password', { method: 'POST', headers: tokens.webClient, body: input }))
}

export function useCustomerSession() {
  return {
    refresh: tokens.refresh,
    signedIn,
    login,
    register,
    logout,
    accountFetch,
    optionalAuthFetch,
    loadProfile,
    changePassword,
  }
}
