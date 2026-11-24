import { ProductSnapshot } from '../catalog/publication.ts'
import type { DbClient } from '../db.ts'

/**
 * A cart line's variant as the customer sees it. `snapshot` is the product's live version (`null` when unpublished);
 * `variant` is that snapshot's variant, `null` when it can no longer be bought.
 */
export type CartVariant = { snapshot: ProductSnapshot | null; variant: ProductSnapshot['variants'][number] | null }

/**
 * Reads variants from the live version (CODING_STANDARDS "Snapshot đã xuất bản"). Outside the snapshot only the
 * variant's discontinued status is read (spec "Đặt mua"): discontinued after the last publish means not for sale.
 * Ids missing from the result are variants that do not exist.
 */
export async function cartVariants(db: DbClient, variantIds: readonly string[]): Promise<Map<string, CartVariant>> {
  const rows = await db.productVariant.findMany({
    where: { id: { in: [...variantIds] } },
    select: { id: true, status: true, product: { select: { id: true, liveVersion: { select: { snapshot: true } } } } },
  })
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
