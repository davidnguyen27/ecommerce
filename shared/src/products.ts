import { z } from 'zod'
import { AttributeDefinition, AttributeValues } from './attributes.ts'
import { ProductType } from './catalog.ts'
import { PublicCommitment } from './commitments.ts'
import { ImageRenditions } from './media.ts'
import { Slug } from './slug.ts'

export const ProductStatus = z.enum(['draft', 'published', 'archived'])
export type ProductStatus = z.infer<typeof ProductStatus>

/** On sale or discontinued (GLOSSARY "Ngừng bán"). */
export const VariantStatus = z.enum(['active', 'discontinued'])
export type VariantStatus = z.infer<typeof VariantStatus>

const Cell = z.string().trim().max(200)

/** Size chart: one header row and data rows with the same number of columns. */
export const SizeChart = z
  .object({
    columns: z.array(Cell.min(1)).min(1).max(20),
    rows: z.array(z.array(Cell)).max(100),
  })
  .superRefine(({ columns, rows }, ctx) => {
    rows.forEach((row, index) => {
      if (row.length !== columns.length) {
        ctx.addIssue({ code: 'custom', path: ['rows', index], message: `Hàng phải có đúng ${columns.length} ô` })
      }
    })
  })
export type SizeChart = z.infer<typeof SizeChart>

const LongText = z.string().max(20_000).default('')

/** Editable part of a product. Status is not here: new products are always drafts. */
export const ProductRequest = z.object({
  brandId: z.uuid(),
  /** The product type comes from the category at creation; later only categories of the same type are allowed. */
  categoryId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  slug: Slug,
  modelCode: z.string().trim().max(100).default(''),
  description: LongText,
  /** Usage and care instructions. */
  usageCare: LongText,
  sizeChart: SizeChart.nullable().default(null),
  /** Published origin statement; warranty is only an evidenced commitment (ADR 0005). */
  originStatement: LongText,
  /** Product-level attributes, validated against the product type schema. */
  attributes: z.record(z.string(), z.unknown()).default({}),
  groundShippingOnly: z.boolean().default(false),
})
export type ProductRequest = z.input<typeof ProductRequest>

/** VND price including VAT, positive integer. */
const Price = z.number().int('Giá phải là số nguyên VND').positive('Giá phải lớn hơn 0').max(1_000_000_000_000)

/** SKUs are stored uppercase, so `abc-1` and `ABC-1` are one SKU. */
export const Sku = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'SKU chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang, gạch dưới')
  .transform((sku) => sku.toUpperCase())

/**
 * A variant. Omitted `price`, `compareAtPrice` stay unchanged; a price different from the current one needs
 * `price.edit`. Compare-at price is empty or not below the sale price.
 */
export const VariantRequest = z.object({
  sku: Sku,
  attributes: z.record(z.string(), z.unknown()).default({}),
  status: VariantStatus.default('active'),
  /** Omitted on create means last. */
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  price: Price.nullable().optional(),
  compareAtPrice: Price.nullable().optional(),
})
export type VariantRequest = z.input<typeof VariantRequest>

export const AdminVariant = z.object({
  id: z.string(),
  sku: z.string(),
  attributes: AttributeValues,
  price: z.number().nullable(),
  compareAtPrice: z.number().nullable(),
  status: VariantStatus,
  sortOrder: z.number(),
})
export type AdminVariant = z.infer<typeof AdminVariant>

export const AdminProduct = z.object({
  id: z.string(),
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
  attributes: AttributeValues,
  groundShippingOnly: z.boolean(),
  status: ProductStatus,
  updatedAt: z.string(),
  /** In display order. */
  variants: z.array(AdminVariant),
})
export type AdminProduct = z.infer<typeof AdminProduct>

const Ref = z.object({ id: z.string(), name: z.string() })

export const AdminProductSummary = z.object({
  id: z.string(),
  productType: ProductType,
  name: z.string(),
  slug: z.string(),
  modelCode: z.string(),
  brand: Ref,
  category: Ref,
  status: ProductStatus,
  variantCount: z.number(),
  updatedAt: z.string(),
})
export type AdminProductSummary = z.infer<typeof AdminProductSummary>

export const AdminProductList = z.object({ items: z.array(AdminProductSummary) })
export type AdminProductList = z.infer<typeof AdminProductList>

// Lifecycle and publishing

/**
 * Status transitions: Draft → Published, Draft → Archived, Published → Archived, Archived → Draft. Sending
 * `published` while published republishes the changes.
 */
export const ChangeProductStatusRequest = z.object({ status: ProductStatus })
export type ChangeProductStatusRequest = z.infer<typeof ChangeProductStatusRequest>

/** Policy pages applying to the product, replacing the whole list. */
export const ProductPoliciesRequest = z.object({ pageIds: z.array(z.uuid()).max(50) })
export type ProductPoliciesRequest = z.infer<typeof ProductPoliciesRequest>

/** Policy pages to pick for a product; product editors do not need content edit rights. */
export const PolicyPageOptionList = z.object({
  items: z.array(z.object({ id: z.string(), slug: z.string(), title: z.string(), published: z.boolean() })),
})
export type PolicyPageOptionList = z.infer<typeof PolicyPageOptionList>

export const AdminProductDetail = AdminProduct.extend({
  /** Like `AdminProduct.variants`, with stock on hand (read-only; change stock via `/api/admin/stock`). */
  variants: z.array(AdminVariant.extend({ onHand: z.number() })),
  /** Linked policy pages, unpublished ones included (customers only see published pages). */
  policyPageIds: z.array(z.string()),
  /** The version customers see; `null` when the product is not published. */
  liveVersion: z.object({ version: z.number(), publishedAt: z.string() }).nullable(),
  /** The draft differs from the version customers see; only meaningful once published. */
  hasUnpublishedChanges: z.boolean(),
})
export type AdminProductDetail = z.infer<typeof AdminProductDetail>

// Website

export const PublicImage = ImageRenditions.extend({ alt: z.string() })
export type PublicImage = z.infer<typeof PublicImage>

/**
 * What customers see about a variant: in stock, open for pre-order (out of stock but in an open campaign with
 * allocation left), or out of stock. Pre-order stock does not count as in stock (GLOSSARY "Đang nhận đặt trước").
 */
export const VariantAvailability = z.enum(['in_stock', 'preorder', 'out_of_stock'])
export type VariantAvailability = z.infer<typeof VariantAvailability>

/** A variant's pre-order campaign as customers see it: deposit percent and expected delivery (`YYYY-MM-DD`). */
export const PreorderOffer = z.object({
  campaignId: z.string(),
  depositPercent: z.number(),
  deliveryFrom: z.string(),
  deliveryTo: z.string(),
})
export type PreorderOffer = z.infer<typeof PreorderOffer>

/** Product card on category and brand pages. */
export const ProductCard = z.object({
  slug: z.string(),
  name: z.string(),
  brand: z.object({ slug: z.string(), name: z.string() }),
  /** Lowest price among variants on sale ("từ X ₫"). */
  fromPrice: z.number(),
  /** Compare-at price of that lowest-priced variant. */
  compareAtPrice: z.number().nullable(),
  image: PublicImage.nullable(),
  /** At least one visible variant is in stock; never with a count (ADR 0006). */
  inStock: z.boolean(),
  /** No stock but at least one variant open for pre-order: the card gets a "Đặt trước" label. */
  preorder: z.boolean(),
})
export type ProductCard = z.infer<typeof ProductCard>

export const PRODUCT_PAGE_SIZE = 24

/** Result order; empty means relevance with a keyword, otherwise newest published first. */
export const ProductSort = z.enum(['newest', 'price_asc', 'price_desc'])
export type ProductSort = z.infer<typeof ProductSort>

/** Attribute filters in the URL are `attr.<key>=<value>`, repeated for several values (e.g. `attr.gioi_tinh=Nam`). */
export const ATTRIBUTE_FILTER_PREFIX = 'attr.'

/** Empty form fields arrive as empty strings; treated as no filter. */
const blank = (value: unknown) => (value === '' ? undefined : value)
const QueryText = z.preprocess(blank, z.string().trim().max(200).optional())
const PriceBound = z.preprocess(blank, z.coerce.number().int().min(0).max(1_000_000_000_000).optional())
const FilterValues = z
  .union([z.string(), z.array(z.string())])
  .transform((values) =>
    [values]
      .flat()
      .map((v) => v.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().max(100)).max(50))

export const ProductListQuery = z.object({
  /** Keyword: product name, brand name, model code (diacritics and small typos tolerated) or SKU. */
  q: QueryText,
  /** Category slug; includes products in subcategories. */
  category: QueryText,
  /** Brand slug. */
  brand: QueryText,
  /** Product type; on category pages it comes from the category. */
  type: z.preprocess(blank, ProductType.optional()),
  /** VND price range, compared with the prices of variants on sale. */
  minPrice: PriceBound,
  maxPrice: PriceBound,
  sort: z.preprocess(blank, ProductSort.optional()),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  /** Attribute key → chosen values, gathered from `attr.<key>` by `attributeFiltersOf`. */
  attributes: z.record(z.string(), FilterValues).default({}),
})
export type ProductListQuery = z.input<typeof ProductListQuery>

/** Gathers the `attr.<key>` query params into `{ key: values }`. */
export function attributeFiltersOf(query: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([name]) => name.startsWith(ATTRIBUTE_FILTER_PREFIX))
      .map(([name, value]) => [name.slice(ATTRIBUTE_FILTER_PREFIX.length), value]),
  )
}

/** Published products, one page. */
export const ProductCardList = z.object({
  items: z.array(ProductCard),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
})
export type ProductCardList = z.infer<typeof ProductCardList>

/** One attribute filter and the product count per value, keeping every other filter. */
export const AttributeFacet = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['enum', 'multi_enum', 'text', 'number', 'boolean']),
  unit: z.string().nullable(),
  values: z.array(z.object({ value: z.string(), count: z.number() })),
})
export type AttributeFacet = z.infer<typeof AttributeFacet>

/** Search and filter result: a page of product cards with facets. */
export const ProductSearchResult = ProductCardList.extend({
  /** Product type in view (from `type` or the category); `null` allows only gender, shared by all types. */
  productType: ProductType.nullable(),
  facets: z.object({
    /** Product count per type, to narrow down before a type is picked. */
    productTypes: z.array(z.object({ productType: ProductType, count: z.number() })),
    /** The current type's `filterable` attributes, in schema order. */
    attributes: z.array(AttributeFacet),
    /** Lowest and highest price among variants on sale; `null` without products. */
    price: z.object({ min: z.number(), max: z.number() }).nullable(),
  }),
})
export type ProductSearchResult = z.infer<typeof ProductSearchResult>

/** A product's published version, as customers see it. */
export const PublicProduct = z.object({
  slug: z.string(),
  name: z.string(),
  productType: ProductType,
  /** `slug` is `null` when the brand is hidden (no page of its own). */
  brand: z.object({ slug: z.string().nullable(), name: z.string() }),
  /** `null` when the category is hidden. */
  category: z.object({ slug: z.string(), name: z.string() }).nullable(),
  modelCode: z.string(),
  description: z.string(),
  usageCare: z.string(),
  sizeChart: SizeChart.nullable(),
  originStatement: z.string(),
  attributes: AttributeValues,
  groundShippingOnly: z.boolean(),
  /** The product type's attribute definitions, for labels. */
  attributeSchema: z.array(AttributeDefinition),
  /** Only variants on sale, in display order. */
  variants: z.array(
    z.object({
      /** Variant id in the published version; the cart stores this id. */
      id: z.string(),
      sku: z.string(),
      attributes: AttributeValues,
      price: z.number(),
      compareAtPrice: z.number().nullable(),
      /** In or out of stock, read straight from stock rather than the published version (ADR 0006). */
      inStock: z.boolean(),
      /** `in_stock` if and only if `inStock`; otherwise open for pre-order or out of stock. */
      availability: VariantAvailability,
      /** Present if and only if `availability` is `preorder`. */
      preorder: PreorderOffer.nullable(),
    }),
  ),
  /** In display order; empty `skus` means a shared image. */
  images: z.array(PublicImage.extend({ skus: z.array(z.string()) })),
  /** Published policy pages that apply. */
  policies: z.array(z.object({ slug: z.string(), title: z.string() })),
  /**
   * Evidenced commitments, separate from the origin statement; warranty is only here (ADR 0005). Taken from the
   * published version like every other field.
   */
  commitments: z.array(PublicCommitment),
  publishedAt: z.string(),
})
export type PublicProduct = z.infer<typeof PublicProduct>
