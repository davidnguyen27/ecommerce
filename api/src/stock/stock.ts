import type { StockAdjustmentReason, StockMovementKind } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { conflictField } from '../http/errors.ts'

/**
 * Những biến thể còn hàng trong `variantIds`. Khách chỉ thấy còn hay hết, đọc trực tiếp từ tồn chứ không từ
 * phiên bản xuất bản (ADR 0006), và không bao giờ thấy số lượng.
 */
export async function inStockIds(db: DbClient, variantIds: readonly string[]): Promise<Set<string>> {
  // Hàng đang giữ cho đơn không còn bán được (ADR 0007).
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id"::text AS id FROM "product_variant"
    WHERE "id" = ANY(${[...variantIds]}::uuid[]) AND "on_hand" - "reserved" > 0`
  return new Set(rows.map((r) => r.id))
}

/**
 * Những dòng giỏ mua được đủ số lượng: tồn trừ số đang giữ không ít hơn số khách muốn mua. Như `inStockIds`, chỉ trả
 * id, không bao giờ trả số lượng.
 */
export async function enoughStockIds(
  db: DbClient,
  lines: readonly { variantId: string; quantity: number }[],
): Promise<Set<string>> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT v."id"::text AS id
    FROM "product_variant" v
    JOIN unnest(${lines.map((l) => l.variantId)}::uuid[], ${lines.map((l) => l.quantity)}::int[]) AS l("id", "quantity")
      ON l."id" = v."id"
    WHERE v."on_hand" - v."reserved" >= l."quantity"`
  return new Set(rows.map((r) => r.id))
}

/** Biến thể đang bị khóa để đổi tồn hoặc giữ hàng. */
export type LockedVariant = { id: string; sku: string; productId: string; onHand: number; reserved: number }

/** Khóa các biến thể `FOR UPDATE` theo thứ tự id, để nhiều request trên cùng nhóm biến thể không deadlock. */
async function lockVariants(tx: Prisma.TransactionClient, variantIds: readonly string[]) {
  const ids = [...new Set(variantIds)].sort()
  const rows = await tx.$queryRaw<LockedVariant[]>`
    SELECT "id"::text AS id, "sku", "product_id"::text AS "productId", "on_hand" AS "onHand", "reserved"
    FROM "product_variant" WHERE "id" = ANY(${ids}::uuid[]) ORDER BY "id" FOR UPDATE`
  return { ids, locked: new Map(rows.map((row) => [row.id, row])) }
}

/** Mã các đơn đang giữ hàng của biến thể: chưa thanh toán, hoặc đã trả mà chưa bàn giao vận chuyển. */
export async function ordersHoldingVariant(db: DbClient, variantId: string): Promise<number[]> {
  const orders = await db.order.findMany({
    where: {
      lines: { some: { variantId } },
      OR: [
        { status: 'pending_payment' },
        { status: 'processing', fulfillmentStatus: { in: ['not_prepared', 'preparing'] } },
      ],
    },
    select: { code: true },
    orderBy: { code: 'asc' },
  })
  return orders.map((o) => o.code)
}

/** Số cái cần giữ (hoặc nhả) của một biến thể. */
export type Reservation = { variantId: string; quantity: number }

/**
 * Giữ hàng cho một đơn (ADR 0007), cùng đường khóa với `changeStock`. Mọi dòng phải đủ `on_hand - reserved`; thiếu
 * ở bất kỳ dòng nào thì không giữ dòng nào và trả id các biến thể thiếu, để nơi gọi báo lỗi theo dòng rồi rollback.
 * Không ghi sổ xuất nhập: hàng chưa rời kho.
 */
export async function reserveStock(
  tx: Prisma.TransactionClient,
  lines: readonly Reservation[],
): Promise<{ ok: true } | { ok: false; shortVariantIds: string[] }> {
  const { locked } = await lockVariants(
    tx,
    lines.map((l) => l.variantId),
  )
  const short = lines.filter((line) => {
    const variant = locked.get(line.variantId)
    return !variant || variant.onHand - variant.reserved < line.quantity
  })
  if (short.length > 0) return { ok: false, shortVariantIds: short.map((l) => l.variantId) }
  for (const line of lines) {
    await tx.productVariant.update({ where: { id: line.variantId }, data: { reserved: { increment: line.quantity } } })
  }
  return { ok: true }
}

/** Nhả hàng đã giữ (hủy, hết hạn), cùng đường khóa với `changeStock`. Không ghi sổ xuất nhập. */
export async function releaseStock(tx: Prisma.TransactionClient, lines: readonly Reservation[]) {
  await lockVariants(
    tx,
    lines.map((l) => l.variantId),
  )
  for (const line of lines) {
    await tx.productVariant.update({ where: { id: line.variantId }, data: { reserved: { decrement: line.quantity } } })
  }
}

/** Một thay đổi tồn; `path` là trường của request để báo lỗi khi tồn không đủ. */
export type StockChange = {
  variantId: string
  /** Có dấu, khác 0. */
  quantity: number
  kind: StockMovementKind
  reason?: StockAdjustmentReason
  note?: string
  /** Phiếu nhập; bắt buộc với loại `receipt` (check constraint). */
  receiptId?: string
  /** Đơn của dòng xuất bán; bắt buộc với loại `sale` (check constraint). */
  orderId?: string
  /**
   * Số đang giữ nhả cùng lúc với thay đổi này (dương): bàn giao vận chuyển trừ tồn và số giữ của đơn cùng nhau, nên
   * chốt "tồn không thấp hơn số đang giữ" tính trên số giữ còn lại.
   */
  releaseReserved?: number
  path: string
}

/**
 * Đường duy nhất để đổi tồn: khóa các biến thể `FOR UPDATE` theo thứ tự id (nhiều request trên cùng nhóm biến thể
 * không deadlock), để `plan` quyết định thay đổi dựa trên tồn đã khóa, rồi cập nhật tồn và ghi sổ xuất nhập.
 * Gọi trong transaction của `audited()`; tồn âm, hoặc tồn thấp hơn số còn giữ sau `releaseReserved`, thì ném 409 và
 * transaction rollback.
 */
export async function changeStock(
  tx: Prisma.TransactionClient,
  actorId: string,
  variantIds: readonly string[],
  plan: (locked: ReadonlyMap<string, LockedVariant>) => StockChange[] | Promise<StockChange[]>,
) {
  const { ids, locked } = await lockVariants(tx, variantIds)
  // `plan` có thể đọc thêm DB (ví dụ biến thể đã có dòng sổ chưa); đọc lúc này là đã dưới khóa.
  const changes = await plan(locked)

  const onHand = new Map([...locked.values()].map((row) => [row.id, row.onHand]))
  const reserved = new Map([...locked.values()].map((row) => [row.id, row.reserved]))
  const movements = []
  for (const change of changes) {
    const variant = locked.get(change.variantId)
    if (!ids.includes(change.variantId)) throw new Error(`Biến thể ${change.variantId} chưa được khóa`)
    // Biến thể đã bị xóa giữa lúc đọc ngoài transaction và lúc khóa.
    if (!variant) throw conflictField(change.path, 'Biến thể không còn tồn tại, hãy tải lại trang')
    const after = onHand.get(variant.id)! + change.quantity
    const reservedAfter = reserved.get(variant.id)! - (change.releaseReserved ?? 0)
    if (reservedAfter < 0) throw new Error(`Nhả ${change.releaseReserved} của ${variant.sku} nhiều hơn số đang giữ`)
    if (after < 0) {
      throw conflictField(change.path, `Tồn của ${variant.sku} không đủ: hiện còn ${onHand.get(variant.id)}`)
    }
    // Hàng đang giữ cho đơn đã thuộc về khách; hạ tồn xuống dưới số đó phải xử lý các đơn trước (ADR 0007).
    if (change.quantity < 0 && after < reservedAfter) {
      const orderCodes = await ordersHoldingVariant(tx, variant.id)
      throw conflictField(
        change.path,
        `Tồn của ${variant.sku} không thể thấp hơn ${reservedAfter} đang giữ cho đơn ${orderCodes.map((c) => `#${c}`).join(', ')}`,
        { reserved: reservedAfter, orderCodes },
      )
    }
    onHand.set(variant.id, after)
    reserved.set(variant.id, reservedAfter)
    movements.push({ ...change, onHandAfter: after })
  }

  for (const [id, value] of onHand) {
    const before = locked.get(id)!
    const reservedValue = reserved.get(id)!
    if (value !== before.onHand || reservedValue !== before.reserved) {
      await tx.productVariant.update({ where: { id }, data: { onHand: value, reserved: reservedValue } })
    }
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
          receiptId: m.receiptId ?? null,
          orderId: m.orderId ?? null,
          actorId,
        },
      }),
    )
  }
  return { locked, movements: created }
}
