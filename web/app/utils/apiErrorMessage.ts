import { ApiErrorBody, type FieldError } from '@ecommerce/shared'

/** Per-field errors in the API error body; empty when none. */
export function apiFieldErrors(error: unknown): FieldError[] {
  const body = ApiErrorBody.safeParse((error as { data?: unknown }).data)
  return body.success ? (body.data.error.fields ?? []) : []
}

/** Data attached to the error (`error.details`), e.g. current stock on a stock adjustment 409; else `undefined`. */
export function apiErrorDetails(error: unknown): Record<string, unknown> | undefined {
  const body = ApiErrorBody.safeParse((error as { data?: unknown }).data)
  return body.success ? body.data.error.details : undefined
}

/** The message from the API's uniform error body, or a generic one when the server is unreachable. */
export function apiErrorMessage(error: unknown): string {
  const body = ApiErrorBody.safeParse((error as { data?: unknown }).data)
  return body.success ? body.data.error.message : 'Không kết nối được máy chủ'
}
