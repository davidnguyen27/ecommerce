import { z } from 'zod'
import * as shared from '@ecommerce/shared'

// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export const BrandDto = shared.BrandRequest
export type BrandInput = z.output<typeof BrandDto>

/** Admin URL id: a malformed one is a 400, as before the move. */
export const BrandParams = z.object({ id: z.uuid() })
export const SlugParams = z.object({ slug: z.string() })
