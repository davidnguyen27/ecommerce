import { ApiErrorBody, type FieldError } from '@ecommerce/shared'

/** Lỗi theo từng trường trong body lỗi của API; rỗng khi không có. */
export function apiFieldErrors(error: unknown): FieldError[] {
  const body = ApiErrorBody.safeParse((error as { data?: unknown }).data)
  return body.success ? (body.data.error.fields ?? []) : []
}

/** Dữ liệu kèm lỗi (`error.details`), ví dụ tồn hiện tại khi điều chỉnh tồn bị 409; không có thì `undefined`. */
export function apiErrorDetails(error: unknown): Record<string, unknown> | undefined {
  const body = ApiErrorBody.safeParse((error as { data?: unknown }).data)
  return body.success ? body.data.error.details : undefined
}

/** Thông báo lỗi từ body lỗi thống nhất của API, hoặc thông báo chung khi không gọi được máy chủ. */
export function apiErrorMessage(error: unknown): string {
  const body = ApiErrorBody.safeParse((error as { data?: unknown }).data)
  return body.success ? body.data.error.message : 'Không kết nối được máy chủ'
}
