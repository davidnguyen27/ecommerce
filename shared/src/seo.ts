import { z } from 'zod'

/**
 * Pages customers can open, for the website sitemap.xml. `path` is the website path (e.g. `/san-pham/x`); products and
 * content pages come from their published version, `lastModified` is the publish time.
 */
export const Sitemap = z.object({
  entries: z.array(z.object({ path: z.string(), lastModified: z.string() })),
})
export type Sitemap = z.infer<typeof Sitemap>
