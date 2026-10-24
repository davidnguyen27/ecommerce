import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ErrorCode, type ApiErrorBody, type FieldError } from '@ecommerce/shared'
import { Prisma } from '../generated/prisma/client.ts'

/** Lỗi có chủ đích; error handler chuyển nó thành body lỗi thống nhất. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldError[],
  ) {
    super(message)
  }
}

/** 400 gắn với một trường của form. */
export const invalidField = (path: string, message: string) =>
  new AppError(400, ErrorCode.VALIDATION_ERROR, message, [{ path, message }])

/** 409 gắn với một trường của form. */
export const conflictField = (path: string, message: string) =>
  new AppError(409, ErrorCode.CONFLICT, message, [{ path, message }])

/** Lỗi unique constraint của Postgres qua Prisma. */
export const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

/** Dùng trong `.catch`: lỗi unique constraint thành lỗi nghiệp vụ `toError()`, lỗi khác ném lại nguyên. */
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
  // AppError là lỗi có chủ đích, nơi ném đã tự log nếu cần; chỉ log lỗi bất ngờ.
  if (!(err instanceof AppError) && error.status >= 500) req.log.error({ err }, 'Lỗi không mong đợi')

  const body: ApiErrorBody = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.fields && { fields: error.fields }),
      requestId: String(req.id),
    },
  }
  res.status(error.status).json(body)
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err
  // body-parser báo lỗi phía client (JSON hỏng, body quá lớn, charset lạ) bằng `status` 4xx.
  const status = err instanceof Error && 'status' in err ? Number(err.status) : 500
  if (status >= 400 && status < 500) {
    return new AppError(status, ErrorCode.VALIDATION_ERROR, 'Body của request không hợp lệ')
  }
  return new AppError(500, ErrorCode.INTERNAL_ERROR, 'Lỗi hệ thống')
}
