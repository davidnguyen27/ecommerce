import { StaffProfile, type Permission } from '@ecommerce/shared'

// `/admin/**` chỉ chạy ở trình duyệt nên giữ phiên trong biến module là đủ.
const tokens = createTokenSession('/api/admin/auth')
const profile = ref<StaffProfile | null>(null)

async function login(email: string, password: string) {
  await tokens.start('/login', { email, password })
  profile.value = null
}

async function logout() {
  await tokens.end()
  profile.value = null
  await navigateTo('/admin/login')
}

/** Gọi `/api/admin/*` kèm access token; hết phiên thì về trang đăng nhập. */
async function adminFetch(path: string, options?: Parameters<typeof tokens.authorizedFetch>[1]): Promise<unknown> {
  try {
    return await tokens.authorizedFetch(path, options)
  } catch (error) {
    if (isUnauthorized(error)) await navigateTo('/admin/login')
    throw error
  }
}

/** Nạp lại nhân viên đang đăng nhập kèm quyền, để menu theo kịp khi role vừa bị đổi. */
async function loadProfile(): Promise<StaffProfile> {
  profile.value = StaffProfile.parse(await adminFetch('/api/admin/me'))
  return profile.value
}

/** Có quyền này, hoặc khi truyền danh sách thì có ít nhất một quyền trong đó. */
function can(permission: Permission | readonly Permission[]): boolean {
  const anyOf: readonly Permission[] = typeof permission === 'string' ? [permission] : permission
  return anyOf.some((p) => profile.value?.permissions.includes(p) ?? false)
}

export function useAdminSession() {
  return {
    isLoggedIn: computed(() => tokens.accessToken.value !== null),
    profile: readonly(profile),
    refresh: tokens.refresh,
    login,
    logout,
    adminFetch,
    loadProfile,
    can,
  }
}
