import { z } from 'zod'

/** `page` và `pageSize` trong query string của các danh sách quản trị. */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

/** Một trang của danh sách `item`, kèm tổng số để phân trang. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), total: z.number(), page: z.number(), pageSize: z.number() })
