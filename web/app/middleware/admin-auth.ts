/**
 * Trang quản trị cần phiên nhân viên; chưa có access token thì thử refresh trước khi đẩy về trang đăng nhập.
 * Trang khai báo `permission` trong `definePageMeta` thì thiếu quyền sẽ bị đưa về trang chính.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const session = useAdminSession()
  if (!session.isLoggedIn.value && !(await session.refresh())) return navigateTo('/admin/login')

  await session.loadProfile()
  if (to.meta.permission && !session.can(to.meta.permission)) return navigateTo('/admin')
})
