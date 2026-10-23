import { z } from 'zod'

/**
 * Các trang khách mở được, để website dựng sitemap.xml. `path` là đường dẫn trên website (ví dụ `/san-pham/x`);
 * sản phẩm và trang nội dung lấy từ phiên bản đang xuất bản, `lastModified` là lúc xuất bản.
 */
export const Sitemap = z.object({
  entries: z.array(z.object({ path: z.string(), lastModified: z.string() })),
})
export type Sitemap = z.infer<typeof Sitemap>
