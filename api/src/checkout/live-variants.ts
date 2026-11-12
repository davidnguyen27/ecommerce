import { ProductSnapshot } from '../catalog/publication.ts'
import type { DbClient } from '../db.ts'

/**
 * Biến thể của một dòng giỏ như khách đang thấy. `snapshot` là phiên bản đang xuất bản của sản phẩm (`null` khi sản
 * phẩm không còn xuất bản); `variant` là biến thể trong snapshot đó, `null` khi không mua được nữa.
 */
export type CartVariant = { snapshot: ProductSnapshot | null; variant: ProductSnapshot['variants'][number] | null }

/**
 * Đọc các biến thể từ phiên bản đang xuất bản (CODING_STANDARDS "Snapshot đã xuất bản"). Ngoài snapshot chỉ đọc
 * trạng thái ngừng bán của biến thể (spec "Đặt mua"): ngừng bán sau lần xuất bản cuối thì cũng không bán nữa.
 * Id không có trong kết quả là biến thể không tồn tại.
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
