import { z } from 'zod'
import { ImageRenditions } from './media.ts'
import { Slug } from './slug.ts'

/** The five fixed product types, roots of the category tree (ADR 0004). */
export const ProductType = z.enum(['footwear', 'apparel', 'watch', 'bag', 'fragrance'])
export type ProductType = z.infer<typeof ProductType>

const Name = z.string().trim().min(1).max(200)

// Brands

export const BrandRequest = z.object({
  name: Name,
  slug: Slug,
  description: z.string().max(10_000).default(''),
})
export type BrandRequest = z.infer<typeof BrandRequest>

export const AdminBrand = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  hidden: z.boolean(),
  /** `null` when there is no logo. */
  logo: ImageRenditions.nullable(),
  updatedAt: z.string(),
})
export type AdminBrand = z.infer<typeof AdminBrand>

export const AdminBrandList = z.object({ items: z.array(AdminBrand) })
export type AdminBrandList = z.infer<typeof AdminBrandList>

/** A visible brand, as customers see it. */
export const PublicBrand = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  logo: ImageRenditions.nullable(),
})
export type PublicBrand = z.infer<typeof PublicBrand>

export const PublicBrandList = z.object({ items: z.array(PublicBrand.pick({ slug: true, name: true })) })
export type PublicBrandList = z.infer<typeof PublicBrandList>

// Categories

/** Editable part of a category. The product type is fixed at creation; reparenting stays within the type. */
export const UpdateCategoryRequest = z.object({
  name: Name,
  slug: Slug,
  /** `null` is a direct child of the product type. */
  parentId: z.uuid().nullable(),
})
export type UpdateCategoryRequest = z.infer<typeof UpdateCategoryRequest>

export const CreateCategoryRequest = UpdateCategoryRequest.extend({
  productType: ProductType,
  parentId: z.uuid().nullable().default(null),
})
export type CreateCategoryRequest = z.infer<typeof CreateCategoryRequest>

export const AdminCategory = z.object({
  id: z.string(),
  productType: ProductType,
  parentId: z.string().nullable(),
  slug: z.string(),
  name: z.string(),
  hidden: z.boolean(),
})
export type AdminCategory = z.infer<typeof AdminCategory>

export const AdminCategoryList = z.object({ items: z.array(AdminCategory) })
export type AdminCategoryList = z.infer<typeof AdminCategoryList>

const CategoryLink = z.object({ slug: z.string(), name: z.string() })
export type CategoryLink = z.infer<typeof CategoryLink>

export type CategoryNode = CategoryLink & { children: CategoryNode[] }
export const CategoryNode: z.ZodType<CategoryNode> = CategoryLink.extend({
  get children() {
    return z.array(CategoryNode)
  },
})

/** Public category tree: all five types in fixed order, only categories customers can see. */
export const CategoryTree = z.object({
  items: z.array(z.object({ productType: ProductType, children: z.array(CategoryNode) })),
})
export type CategoryTree = z.infer<typeof CategoryTree>

/** Category page: `ancestors` from the root down, excluding the product type. */
export const PublicCategory = CategoryLink.extend({
  productType: ProductType,
  ancestors: z.array(CategoryLink),
  children: z.array(CategoryLink),
})
export type PublicCategory = z.infer<typeof PublicCategory>
