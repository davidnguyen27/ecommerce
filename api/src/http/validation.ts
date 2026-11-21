import type { z } from 'zod'
import { ErrorCode } from '@ecommerce/shared'
import { AppError } from './errors.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Chuỗi là uuid: mã từ URL không đúng dạng thì coi như không thấy, thay vì để Postgres báo lỗi kiểu. */
export const isUuid = (value: string) => UUID.test(value)

/** Kiểm dữ liệu vào theo schema; sai thì ném lỗi 400 kèm lỗi theo từng trường. */
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input)
  if (result.success) return result.data

  const fields = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }))
  throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Dữ liệu không hợp lệ', fields)
}
