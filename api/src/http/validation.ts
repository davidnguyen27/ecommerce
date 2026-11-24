import type { z } from 'zod'
import { ErrorCode } from '@ecommerce/shared'
import { AppError } from './errors.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The string is a uuid: a malformed id from the URL counts as not found instead of a Postgres type error. */
export const isUuid = (value: string) => UUID.test(value)

/** Validates input against the schema; throws 400 with per-field errors. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input)
  if (result.success) return result.data

  const fields = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
  throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Dữ liệu không hợp lệ', fields)
}
