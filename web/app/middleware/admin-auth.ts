/**
 * Admin pages need a staff session; without an access token, try a refresh before sending to sign-in. Pages declaring
 * `permission` in `definePageMeta` send users without it to the admin home.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const session = useAdminSession()
  if (!session.isLoggedIn.value && !(await session.refresh())) return navigateTo('/admin/login')

  await session.loadProfile()
  if (to.meta.permission && !session.can(to.meta.permission)) return navigateTo('/admin')
})
