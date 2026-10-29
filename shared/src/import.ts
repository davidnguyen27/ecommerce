import { z } from 'zod'

/** Số dòng biến thể tối đa trong một file import, để cả file được kiểm và ghi trong một transaction. */
export const IMPORT_MAX_ROWS = 2000

/** Một lỗi hoặc cảnh báo của file import. `row` là số dòng trong Excel; `column` là tiêu đề cột. */
export const ImportIssue = z.object({
  sheet: z.string(),
  row: z.number().nullable(),
  column: z.string().nullable(),
  message: z.string(),
})
export type ImportIssue = z.infer<typeof ImportIssue>

/** Kết quả xem trước: những gì sẽ được tạo nếu xác nhận. Còn lỗi thì xác nhận sẽ không ghi gì. */
export const ImportPreview = z.object({
  products: z.number(),
  variants: z.number(),
  errors: z.array(ImportIssue),
  warnings: z.array(ImportIssue),
})
export type ImportPreview = z.infer<typeof ImportPreview>

/** Kết quả xác nhận: số sản phẩm (nháp) và biến thể đã tạo. */
export const ImportResult = z.object({ products: z.number(), variants: z.number() })
export type ImportResult = z.infer<typeof ImportResult>
