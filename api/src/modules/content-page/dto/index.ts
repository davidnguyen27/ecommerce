import { z } from 'zod'

// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  CreateContentPageRequest as CreateContentPageDto,
  UpdateContentPageRequest as UpdateContentPageDto,
} from '@ecommerce/shared'

export const PageParams = z.object({ id: z.uuid() })
export const VersionParams = PageParams.extend({ version: z.coerce.number().int().min(1) })
export const SlugParams = z.object({ slug: z.string() })
