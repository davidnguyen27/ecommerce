import { StaffProfile, type Permission } from '@ecommerce/shared'

// `/admin/**` runs only in the browser, so a module variable is enough to hold the session.
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

/** Calls `/api/admin/*` with the access token; an expired session goes to the sign-in page. */
async function adminFetch(path: string, options?: Parameters<typeof tokens.authorizedFetch>[1]): Promise<unknown> {
  try {
    return await tokens.authorizedFetch(path, options)
  } catch (error) {
    if (isUnauthorized(error)) await navigateTo('/admin/login')
    throw error
  }
}

/** Reloads the signed-in staff member and permissions, so the menu follows a role change. */
async function loadProfile(): Promise<StaffProfile> {
  profile.value = StaffProfile.parse(await adminFetch('/api/admin/me'))
  return profile.value
}

/** Has this permission, or with a list, at least one of them. */
function can(permission: Permission | readonly Permission[]): boolean {
  const anyOf: readonly Permission[] = typeof permission === 'string' ? [permission] : permission
  return anyOf.some((p) => profile.value?.permissions.includes(p) ?? false)
}

/**
 * Whether admin page `to` can be opened: links, buttons or figures for another page show only when it can be opened.
 * Permissions come from `ADMIN_PAGE_PERMISSIONS` (menu and subpages), never restated locally (CODING_STANDARDS "Web").
 */
function canOpen(to: string): boolean {
  const permission = ADMIN_PAGE_PERMISSIONS.find((item) => item.to === to)?.permission
  return !permission || can(permission)
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
    canOpen,
  }
}
