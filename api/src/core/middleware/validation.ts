import type { RequestHandler, Response } from 'express'
import type { z } from 'zod'
import { ErrorCode } from '@ecommerce/shared'
import { AppError } from '../errors.ts'

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

/**
 * Route middleware: parses `req[part]` with the schema (400 with per-field errors otherwise) and keeps the result for
 * the controller, which reads it with `dtoOf`. Put it after `requirePermission`, as routes parsed after the check.
 */
export function validate<T extends z.ZodType>(schema: T, part: 'body' | 'query' = 'body'): RequestHandler {
  return (req, res, next) => {
    res.locals.dto = parse(schema, req[part])
    next()
  }
}

/** The input `validate(schema)` parsed for this request; `schema` only types the result. */
export function dtoOf<T extends z.ZodType>(res: Response, _schema: T): z.output<T> {
  return res.locals.dto as z.output<T>
}
