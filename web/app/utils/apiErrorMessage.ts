import { ApiErrorBody } from '@ecommerce/shared'

/** Thông báo lỗi từ body lỗi thống nhất của API, hoặc thông báo chung khi không gọi được máy chủ. */
export function apiErrorMessage(error: unknown): string {
  const body = ApiErrorBody.safeParse((error as { data?: unknown }).data)
  return body.success ? body.data.error.message : 'Không kết nối được máy chủ'
}
