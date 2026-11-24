import { CustomerProfile, type ChangePasswordRequest, type RegisterRequest } from '@ecommerce/shared'

// The customer session lives only in the browser: the refresh cookie is only sent to `/api/auth/refresh`, so the Nuxt
// server never knows who the customer is.
const tokens = createTokenSession('/api/auth')

const login = (email: string, password: string) => tokens.start('/login', { email, password })

const register = (input: RegisterRequest) => tokens.start('/register', input)

async function logout() {
  await tokens.end()
  await navigateTo('/dang-nhap')
}

/** Calls `/api/account/*` with the access token; refreshes first if missing, and counts as signed out if that fails. */
async function accountFetch(path: string, options?: Parameters<typeof tokens.authorizedFetch>[1]): Promise<unknown> {
  if (tokens.accessToken.value === null && !(await tokens.refresh())) throw new Error('Chưa đăng nhập')
  return tokens.authorizedFetch(path, options)
}

/** Whether the customer is signed in; refreshes if there is no access token. Never throws. */
async function signedIn(): Promise<boolean> {
  return tokens.accessToken.value !== null || tokens.refresh()
}

/** Calls APIs open to guests too (e.g. checkout): sends the access token when signed in, nothing otherwise. */
async function optionalAuthFetch(path: string, options?: Parameters<typeof tokens.authorizedFetch>[1]) {
  return (await signedIn()) ? tokens.authorizedFetch(path, options) : $fetch(path, options)
}

async function loadProfile(): Promise<CustomerProfile> {
  return CustomerProfile.parse(await accountFetch('/api/account/me'))
}

/** Changes the password; every other device is signed out, this browser gets a new session. */
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
