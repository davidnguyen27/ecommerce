import type { z } from 'zod'
import {
  GENDER_KEY,
  PRODUCT_PAGE_SIZE,
  ProductType,
  type ProductCard,
  ProductListQuery,
  type ProductSearchResult,
  type ProductSort,
  type PublicProduct,
  type VariantAvailability,
} from '@ecommerce/shared'
import type { Storage } from '../../core/adapters/storage.ts'
import type { Db, DbClient } from '../../core/db.ts'
import { imageRenditions } from '../../core/media/images.ts'
import type { Brand, ProductVersion } from '../../generated/prisma/client.ts'
import type { IAttributeSchemaQuery } from '../attribute-schema/index.ts'
import type { ICategoryQuery } from '../category/index.ts'
import type { CartVariant, IProductQuery, ProductPorts } from './product.interface.ts'
import { cheapestVariant } from './product.mapper.ts'
import { ProductSnapshot } from './product.model.ts'
import type { ProductRepository } from './product.repository.ts'
import type { ProductSearchRepository, SearchCriteria } from './product-search.repository.ts'

// Products as customers see them, shared by the website and chatbot tools (M8): only published products, read from
// the published version. Exceptions: in-stock status is read from stock (ADR 0006) and pre-order availability from
// campaigns (M4).

function toCard(
  storage: Storage,
  version: ProductVersion & { brand: Brand },
  snapshot: ProductSnapshot,
  inStock: boolean,
  preorder: boolean,
): ProductCard {
  const cheapest = cheapestVariant(snapshot)
  const cover = snapshot.images[0]
  return {
    slug: snapshot.slug,
    name: snapshot.name,
    brand: { slug: version.brand.slug, name: version.brand.name },
    fromPrice: cheapest.price,
    compareAtPrice: cheapest.compareAtPrice,
    image: cover ? { ...imageRenditions(storage, cover), alt: cover.alt } : null,
    inStock,
    preorder: !inStock && preorder,
  }
}

/**
 * Reads variants from the live version (CODING_STANDARDS "Snapshot đã xuất bản"). Outside the snapshot only the
 * variant's discontinued status is read (spec "Đặt mua"): discontinued after the last publish means not for sale.
 * Ids missing from the result are variants that do not exist.
 */
export async function readCartVariants(
  repo: ProductRepository,
  db: DbClient,
  variantIds: readonly string[],
): Promise<Map<string, CartVariant>> {
  const rows = await repo.cartRows(db, variantIds)
  const snapshots = new Map<string, ProductSnapshot | null>()
  return new Map(
    rows.map((row) => {
      const { id: productId, liveVersion } = row.product
      if (!snapshots.has(productId)) {
        snapshots.set(productId, liveVersion ? ProductSnapshot.parse(liveVersion.snapshot) : null)
      }
      const snapshot = snapshots.get(productId)!
      const variant = row.status === 'active' ? (snapshot?.variants.find((v) => v.id === row.id) ?? null) : null
      return [row.id, { snapshot, variant }]
    }),
  )
}

/** The customer-facing product reads: search with facets, product page, cart variants. */
export class ProductQuery implements IProductQuery {
  constructor(
    private readonly deps: { prisma: Db; storage: Storage },
    private readonly repo: ProductRepository,
    private readonly search: ProductSearchRepository,
    private readonly schemas: IAttributeSchemaQuery,
    private readonly categories: ICategoryQuery,
    private readonly ports: ProductPorts,
  ) {}

  cartVariants(db: DbClient, variantIds: readonly string[]) {
    return readCartVariants(this.repo, db, variantIds)
  }

  /** One page of matching product cards in display order, with the total. */
  async searchProductCards(
    criteria: SearchCriteria,
    sort: ProductSort | undefined,
    page: number,
    pageSize = PRODUCT_PAGE_SIZE,
  ) {
    const { prisma, storage } = this.deps
    const { versionIds, total } = await this.search.page(prisma, criteria, sort, page, pageSize)
    const versions = await this.repo.versionsWithBrand(prisma, versionIds)
    // Versions with parsed snapshots, by version id.
    const parsedById = new Map(versions.map((v) => [v.id, { version: v, snapshot: ProductSnapshot.parse(v.snapshot) }]))
    const variantIds = [...parsedById.values()].flatMap(({ snapshot }) => snapshot.variants.map((v) => v.id))
    const [stocked, offers] = await Promise.all([
      this.ports.stock.inStockIds(prisma, variantIds),
      this.ports.preorders.offers(prisma, variantIds),
    ])
    const items = versionIds.map((id) => {
      const { version, snapshot } = parsedById.get(id)!
      return toCard(
        storage,
        version,
        snapshot,
        snapshot.variants.some((v) => stocked.has(v.id)),
        snapshot.variants.some((v) => offers.has(v.id)),
      )
    })
    return { items, total }
  }

  /** The website's product list: the product type in view decides filters and facets. */
  async publicSearch(query: z.output<typeof ProductListQuery>): Promise<ProductSearchResult> {
    const { prisma } = this.deps
    const category =
      query.category === undefined ? undefined : await this.repo.findCategoryBySlug(prisma, query.category)
    // When the type is unknown, only gender, shared by all types.
    const productType = category?.productType ?? query.type ?? null
    const schema = await this.schemas.load(prisma, productType ?? ProductType.enum.footwear)
    const filterable = schema.attributes.filter((a) => a.filterable && (productType || a.key === GENDER_KEY))

    const criteria: SearchCriteria = {
      text: query.q,
      categoryIds:
        query.category === undefined ? undefined : await this.repo.categorySubtreeIds(prisma, query.category),
      brandSlug: query.brand,
      productType: query.type,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      // Keys not filterable for the current type (old URL, changed schema) are ignored instead of erroring.
      attributes: filterable.flatMap((definition) => {
        const values = query.attributes[definition.key] ?? []
        return values.length ? [{ definition, values }] : []
      }),
    }
    const [{ items, total }, facets] = await Promise.all([
      this.searchProductCards(criteria, query.sort, query.page),
      this.search.facets(prisma, criteria, filterable),
    ])
    return { items, page: query.page, pageSize: PRODUCT_PAGE_SIZE, total, productType, facets }
  }

  /**
   * A published product by slug, or `null`. An old slug (renamed then republished) still resolves, with the current
   * slug for a 301. Hidden brands or categories do not hide the product (GLOSSARY "Ẩn").
   */
  async findPublicProduct(slug: string): Promise<PublicProduct | null> {
    const { prisma, storage } = this.deps
    const product = await this.repo.findPublishedBySlug(prisma, slug)
    if (!product?.liveVersion) return null
    const version = product.liveVersion
    const snapshot = ProductSnapshot.parse(version.snapshot)
    const variantIds = snapshot.variants.map((v) => v.id)

    const [schema, tree, pages, stocked, offers] = await Promise.all([
      this.schemas.load(prisma, snapshot.productType),
      this.categories.loadVisibleTree(prisma),
      this.repo.publishedPolicyPages(prisma, snapshot.policyPageIds),
      this.ports.stock.inStockIds(prisma, variantIds),
      this.ports.preorders.offers(prisma, variantIds),
    ])
    const skuOf = new Map(snapshot.variants.map((v) => [v.id, v.sku]))
    const category = this.categories.findVisible(tree, version.category.slug)?.category

    return {
      slug: snapshot.slug,
      name: snapshot.name,
      productType: snapshot.productType,
      brand: { slug: version.brand.hidden ? null : version.brand.slug, name: version.brand.name },
      category: category ? { slug: category.slug, name: category.name } : null,
      modelCode: snapshot.modelCode,
      description: snapshot.description,
      usageCare: snapshot.usageCare,
      sizeChart: snapshot.sizeChart,
      originStatement: snapshot.originStatement,
      attributes: snapshot.attributes,
      groundShippingOnly: snapshot.groundShippingOnly,
      attributeSchema: schema.attributes,
      variants: snapshot.variants.map(({ id, sku, attributes, price, compareAtPrice }) => {
        // In stock is never pre-order; the offers port already excludes those variants.
        const inStock = stocked.has(id)
        const preorder = inStock ? null : (offers.get(id) ?? null)
        const availability: VariantAvailability = inStock ? 'in_stock' : preorder ? 'preorder' : 'out_of_stock'
        return { id, sku, attributes, price, compareAtPrice, inStock, availability, preorder }
      }),
      images: snapshot.images.map((image) => ({
        ...imageRenditions(storage, image),
        alt: image.alt,
        skus: image.variantIds.map((id) => skuOf.get(id)!),
      })),
      policies: pages.map((page) => ({ slug: page.slug, title: page.versions[0]!.title })),
      commitments: snapshot.commitments,
      publishedAt: version.publishedAt.toISOString(),
    }
  }
}
