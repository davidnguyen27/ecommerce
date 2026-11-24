import { z } from 'zod'

/** Uniform error code every endpoint returns in `error.code`. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  /** Rate limit exceeded; the response carries a `Retry-After` header (seconds). */
  RATE_LIMITED: 'RATE_LIMITED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  /** An external service (payment gateway) failed; retry later. */
  BAD_GATEWAY: 'BAD_GATEWAY',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export const FieldError = z.object({
  /** Path to the bad field, dot-separated, e.g. `variants.0.price`. */
  path: z.string(),
  message: z.string(),
})
export type FieldError = z.infer<typeof FieldError>

export const ApiErrorBody = z.object({
  error: z.object({
    code: z.enum(ErrorCode),
    message: z.string(),
    fields: z.array(FieldError).optional(),
    /** Data for the client to act on, e.g. current stock when a stock adjustment gets 409. */
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string(),
  }),
})
export type ApiErrorBody = z.infer<typeof ApiErrorBody>
