import { z } from 'zod'
import { ProductType, PublicCommitment, SizeChart } from '@ecommerce/shared'
import { StoredImage } from '../../core/media/images.ts'

export const AttributeValuesShape = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]),
)

/**
 * Everything customers see of a product at publish time. Public endpoints read only this (CODING_STANDARDS
 * "Snapshot đã xuất bản"), evidenced commitments included; brand and category names, policy page titles and attribute
 * labels are read from their own tables.
 */
export const ProductSnapshot = z.object({
  productType: ProductType,
  brandId: z.string(),
  categoryId: z.string(),
  name: z.string(),
  slug: z.string(),
  modelCode: z.string(),
  description: z.string(),
  usageCare: z.string(),
  sizeChart: SizeChart.nullable(),
  originStatement: z.string(),
  attributes: AttributeValuesShape,
  groundShippingOnly: z.boolean(),
  /** Only variants on sale, in display order. */
  variants: z.array(
    z.object({
      id: z.string(),
      sku: z.string(),
      attributes: AttributeValuesShape,
      price: z.number(),
      compareAtPrice: z.number().nullable(),
    }),
  ),
  /** In display order; `variantIds` holds only variants on sale, empty means a shared image. */
  images: z.array(StoredImage.extend({ id: z.string(), alt: z.string(), variantIds: z.array(z.string()) })),
  policyPageIds: z.array(z.string()),
  /** Evidenced commitments as shown; versions published before this field existed have none. */
  commitments: z.array(PublicCommitment).default([]),
})
export type ProductSnapshot = z.infer<typeof ProductSnapshot>
