import type { DbClient } from '../../core/db.ts'
import type { OrderLineImage } from '../order/index.ts'
import type { CartVariant } from '../product/index.ts'

/** The variant's image, else the product's first image. */
export function storedImageOf({ snapshot, variant }: CartVariant): OrderLineImage | null {
  const images = snapshot?.images ?? []
  const image = images.find((i) => variant && i.variantIds.includes(variant.id)) ?? images[0]
  if (!image) return null
  const { key, contentType, width, height, widths, alt } = image
  return { key, contentType, width, height, widths, alt }
}

/** Published versions of the policy pages linked to the products in the order. */
export async function livePolicyVersions(db: DbClient, variants: Iterable<CartVariant>) {
  const pageIds = new Set([...variants].flatMap((v) => (v.variant ? (v.snapshot?.policyPageIds ?? []) : [])))
  const pages = await db.contentPage.findMany({
    where: { id: { in: [...pageIds] }, kind: 'policy' },
    select: { slug: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, title: true } } },
    orderBy: { slug: 'asc' },
  })
  return pages.flatMap(({ slug, versions }) => versions.map(({ id, title }) => ({ id, slug, title })))
}
