import { z } from 'zod'

/** Mã lỗi thống nhất mà mọi endpoint trả về trong `error.code`. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export const FieldError = z.object({
  /** Đường dẫn tới trường lỗi, nối bằng dấu chấm, ví dụ `variants.0.price`. */
  path: z.string(),
  message: z.string(),
})
export type FieldError = z.infer<typeof FieldError>

export const ApiErrorBody = z.object({
  error: z.object({
    code: z.enum(ErrorCode),
    message: z.string(),
    fields: z.array(FieldError).optional(),
    requestId: z.string(),
  }),
})
export type ApiErrorBody = z.infer<typeof ApiErrorBody>
