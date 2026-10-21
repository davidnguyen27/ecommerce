/** Trang quản trị cần phiên nhân viên; chưa có access token thì thử refresh trước khi đẩy về trang đăng nhập. */
export default defineNuxtRouteMiddleware(async () => {
  const session = useAdminSession()
  if (session.isLoggedIn.value || (await session.refresh())) return
  return navigateTo('/admin/login')
})
