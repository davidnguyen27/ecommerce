import { z } from 'zod'

/** Max variant rows per import file, so the whole file is checked and written in one transaction. */
export const IMPORT_MAX_ROWS = 2000

/** An import error or warning. `row` is the Excel row number; `column` the column header. */
export const ImportIssue = z.object({
  sheet: z.string(),
  row: z.number().nullable(),
  column: z.string().nullable(),
  message: z.string(),
})
export type ImportIssue = z.infer<typeof ImportIssue>

/** Preview: what confirming would create. With errors left, confirming writes nothing. */
export const ImportPreview = z.object({
  products: z.number(),
  variants: z.number(),
  /** Number of variants (new or existing) that get opening stock. */
  openingStocks: z.number(),
  errors: z.array(ImportIssue),
  warnings: z.array(ImportIssue),
})
export type ImportPreview = z.infer<typeof ImportPreview>

/** Confirm result: draft products and variants created, variants given opening stock. */
export const ImportResult = z.object({ products: z.number(), variants: z.number(), openingStocks: z.number() })
export type ImportResult = z.infer<typeof ImportResult>
