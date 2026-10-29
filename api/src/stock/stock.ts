import type { StockAdjustmentReason, StockMovementKind } from '@ecommerce/shared'
import type { Prisma } from '../generated/prisma/client.ts'
import { conflictField } from '../http/errors.ts'

/** Biến thể đang bị khóa để đổi tồn. */
export type LockedVariant = { id: string; sku: string; productId: string; onHand: number }

/** Một thay đổi tồn; `path` là trường của request để báo lỗi khi tồn không đủ. */
export type StockChange = {
  variantId: string
  /** Có dấu, khác 0. */
  quantity: number
  kind: StockMovementKind
  reason?: StockAdjustmentReason
  note?: string
  path: string
}

/**
 * Đường duy nhất để đổi tồn: khóa các biến thể `FOR UPDATE` theo thứ tự id (nhiều request trên cùng nhóm biến thể
 * không deadlock), để `plan` quyết định thay đổi dựa trên tồn đã khóa, rồi cập nhật tồn và ghi sổ xuất nhập.
 * Gọi trong transaction của `audited()`; tồn âm thì ném 409 và transaction rollback.
 */
export async function changeStock(
  tx: Prisma.TransactionClient,
  actorId: string,
  variantIds: readonly string[],
  plan: (locked: ReadonlyMap<string, LockedVariant>) => StockChange[],
) {
  const ids = [...new Set(variantIds)].sort()
  const rows = await tx.$queryRaw<LockedVariant[]>`
    SELECT "id"::text AS id, "sku", "product_id"::text AS "productId", "on_hand" AS "onHand"
    FROM "product_variant" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`
  const locked = new Map(rows.map((row) => [row.id, row]))
  const changes = plan(locked)

  const onHand = new Map(rows.map((row) => [row.id, row.onHand]))
  const movements = changes.map((change) => {
    const variant = locked.get(change.variantId)
    if (!variant) throw new Error(`Biến thể ${change.variantId} chưa được khóa`)
    const after = onHand.get(variant.id)! + change.quantity
    if (after < 0) {
      throw conflictField(change.path, `Tồn của ${variant.sku} không đủ: hiện còn ${onHand.get(variant.id)}`)
    }
    onHand.set(variant.id, after)
    return { ...change, onHandAfter: after }
  })

  for (const [id, value] of onHand) {
    if (value !== locked.get(id)!.onHand) await tx.productVariant.update({ where: { id }, data: { onHand: value } })
  }
  const created = []
  for (const m of movements) {
    created.push(
      await tx.stockMovement.create({
        data: {
          variantId: m.variantId,
          kind: m.kind,
          quantity: m.quantity,
          onHandAfter: m.onHandAfter,
          reason: m.reason ?? null,
          note: m.note ?? '',
          actorId,
        },
      }),
    )
  }
  return { locked, movements: created }
}
