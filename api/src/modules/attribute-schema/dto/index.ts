import { z } from 'zod'
import { ProductType } from '@ecommerce/shared'

// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  UpdateAttributeSchemaRequest as UpdateAttributeSchemaDto,
  ValidateAttributesRequest as ValidateAttributesDto,
} from '@ecommerce/shared'

export const ProductTypeParams = z.object({ productType: ProductType })
