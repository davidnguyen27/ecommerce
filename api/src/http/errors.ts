import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ErrorCode, type ApiErrorBody, type FieldError } from '@ecommerce/shared'
import { Prisma } from '../generated/prisma/client.ts'

/**
 * Intentional error; the error handler turns it into the standard error body. `retryAfter` (seconds) becomes the
 * `Retry-After` header, so 429 throwers need no Express `res`.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldError[],
    readonly details?: Record<string, unknown>,
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}

/** 400 tied to one form field. */
export const invalidField = (path: string, message: string) =>
  new AppError(400, ErrorCode.VALIDATION_ERROR, message, [{ path, message }])

/** 409 tied to one form field; `details` gives the client the new state to show. */
export const conflictField = (path: string, message: string, details?: Record<string, unknown>) =>
  new AppError(409, ErrorCode.CONFLICT, message, [{ path, message }], details)

/** Postgres unique-constraint violation via Prisma. */
export const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

/** For `.catch`: a unique violation becomes `toError()`, anything else is rethrown. */
export const rethrowUnique =
  (toError: () => AppError) =>
  (err: unknown): never => {
    throw isUniqueViolation(err) ? toError() : err
  }

export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, ErrorCode.NOT_FOUND, `Không tìm thấy ${req.method} ${req.path}`))
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const error = toAppError(err)
  // AppError is intentional and logged at the throw site if needed; log only unexpected errors.
  if (!(err instanceof AppError) && error.status >= 500) req.log.error({ err }, 'Lỗi không mong đợi')

  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields && { fields: error.fields }),
      ...(error.details && { details: error.details }),
      requestId: String(req.id),
    },
  }
  if (error.retryAfter !== undefined) res.setHeader('Retry-After', String(error.retryAfter))
  res.status(error.status).json(body)
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  // body-parser reports client errors (bad JSON, body too large, odd charset) with a 4xx `status`.
  const status = err instanceof Error && 'status' in err ? Number(err.status) : 500
  if (status >= 400 && status < 500) {
    return new AppError(status, ErrorCode.VALIDATION_ERROR, 'Body của request không hợp lệ')
  }
  return new AppError(500, ErrorCode.INTERNAL_ERROR, 'Lỗi hệ thống')
}
