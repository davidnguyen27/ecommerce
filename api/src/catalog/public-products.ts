import {
  PRODUCT_PAGE_SIZE,
  type ProductCard,
  type ProductSort,
  type PublicProduct,
  type VariantAvailability,
} from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { LATEST_VERSION } from '../content/pages.ts'
import type { Db } from '../db.ts'
import type { Brand, ProductVersion } from '../generated/prisma/client.ts'
import { imageRenditions } from '../media/images.ts'
import { preorderOffers } from '../preorders/campaigns.ts'
import { inStockIds } from '../stock/stock.ts'
import { loadAttributeSchema } from './attribute-schemas.ts'
import { findVisible, loadVisibleTree } from './categories.ts'
import { ProductSnapshot, cheapestVariant } from './publication.ts'
import { searchPage, type SearchCriteria } from './search.ts'

// Sản phẩm như khách thấy, dùng chung cho trang web (`routes/public-products.ts`) và công cụ của chatbot (M8): chỉ
// sản phẩm đã xuất bản, chỉ đọc phiên bản đang xuất bản. Ngoại lệ duy nhất là còn hàng hay hết, đọc trực tiếp từ tồn
// (ADR 0006), cùng việc đang nhận đặt trước hay không, đọc trực tiếp từ đợt đặt trước (M4).

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

/** Một trang thẻ sản phẩm khớp điều kiện, theo thứ tự hiển thị, kèm tổng số. */
export async function searchProductCards(
  prisma: Db,
  storage: Storage,
  criteria: SearchCriteria,
  sort: ProductSort | undefined,
  page: number,
  pageSize = PRODUCT_PAGE_SIZE,
) {
  const { versionIds, total } = await searchPage(prisma, criteria, sort, page, pageSize)
  const versions = await prisma.productVersion.findMany({ where: { id: { in: versionIds } }, include: { brand: true } })
  // Phiên bản kèm snapshot đã parse, theo id phiên bản.
  const parsedById = new Map(versions.map((v) => [v.id, { version: v, snapshot: ProductSnapshot.parse(v.snapshot) }]))
  const variantIds = [...parsedById.values()].flatMap(({ snapshot }) => snapshot.variants.map((v) => v.id))
  const [stocked, offers] = await Promise.all([inStockIds(prisma, variantIds), preorderOffers(prisma, variantIds)])
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

/**
 * Sản phẩm đã xuất bản theo slug, hay `null`. Slug cũ (đã đổi rồi xuất bản lại) vẫn trả sản phẩm, kèm slug hiện tại để
 * website chuyển hướng 301. Ẩn thương hiệu, danh mục không làm sản phẩm biến mất (GLOSSARY "Ẩn").
 */
export async function findPublicProduct(prisma: Db, storage: Storage, slug: string): Promise<PublicProduct | null> {
  const include = { liveVersion: { include: { brand: true, category: true } } } as const
  // Slug đang có sản phẩm dùng thì ưu tiên sản phẩm đó; nhiều sản phẩm từng dùng thì lấy lần xuất bản gần nhất.
  const product =
    (await prisma.product.findFirst({ where: { liveVersion: { is: { slug } } }, include })) ??
    (await prisma.product.findFirst({
      where: { status: 'published', versions: { some: { slug } } },
      include,
      orderBy: { liveVersion: { publishedAt: 'desc' } },
    }))
  if (!product?.liveVersion) return null
  const version = product.liveVersion
  const snapshot = ProductSnapshot.parse(version.snapshot)
  const variantIds = snapshot.variants.map((v) => v.id)

  const [schema, tree, pages, stocked, offers] = await Promise.all([
    loadAttributeSchema(prisma, snapshot.productType),
    loadVisibleTree(prisma),
    prisma.contentPage.findMany({
      where: { id: { in: snapshot.policyPageIds }, kind: 'policy', versions: { some: {} } },
      include: { versions: LATEST_VERSION },
      orderBy: { createdAt: 'asc' },
    }),
    inStockIds(prisma, variantIds),
    preorderOffers(prisma, variantIds),
  ])
  const skuOf = new Map(snapshot.variants.map((v) => [v.id, v.sku]))
  const category = findVisible(tree, version.category.slug)?.category

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
      // Còn hàng sẵn thì không bao giờ là đặt trước; `preorderOffers` cũng đã loại các biến thể đó.
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

/** Id của danh mục theo slug và mọi danh mục con cháu, kể cả đang ẩn; slug không có thì rỗng. */
export async function subtreeIds(prisma: Db, slug: string) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE down AS (
      SELECT id FROM category WHERE slug = ${slug}
      UNION ALL
      SELECT c.id FROM category c JOIN down ON c.parent_id = down.id
    )
    SELECT id::text FROM down`
  return rows.map((r) => r.id)
}
