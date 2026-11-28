import { z } from 'zod'
import * as shared from '@ecommerce/shared'

// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export const CreateCategoryDto = shared.CreateCategoryRequest
export const UpdateCategoryDto = shared.UpdateCategoryRequest
export type CreateCategoryInput = z.output<typeof CreateCategoryDto>
export type UpdateCategoryInput = z.output<typeof UpdateCategoryDto>

/** Admin URL id: a malformed one is a 400, as before the move. */
export const CategoryParams = z.object({ id: z.uuid() })
export const SlugParams = z.object({ slug: z.string() })
