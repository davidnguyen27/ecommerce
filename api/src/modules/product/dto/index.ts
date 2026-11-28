import { z } from 'zod'

// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  ChangeProductStatusRequest as ChangeProductStatusDto,
  CommitmentRequest as CommitmentDto,
  ProductListQuery as ProductListQueryDto,
  ProductPoliciesRequest as ProductPoliciesDto,
  ProductRequest as ProductDto,
  ReorderProductImagesRequest as ReorderProductImagesDto,
  UpdateProductImageRequest as UpdateProductImageDto,
  UploadProductImageFields as UploadProductImageDto,
  VariantRequest as VariantDto,
} from '@ecommerce/shared'

/** URL ids: a malformed one is a 400, as before the move. */
export const ProductParams = z.object({ id: z.uuid() })
export const VariantParams = z.object({ id: z.uuid(), variantId: z.uuid() })
export const ImageParams = z.object({ id: z.uuid(), imageId: z.uuid() })
export const DocumentParams = z.object({ id: z.uuid(), documentId: z.uuid() })
export const CommitmentParams = z.object({ id: z.uuid(), commitmentId: z.uuid() })
export const SlugParams = z.object({ slug: z.string() })
