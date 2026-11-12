import { z } from 'zod'
import {
  AttributeDefinition,
  ErrorCode,
  ProductType,
  checkAttributes,
  type AttributeLevel,
  type AttributeValues,
} from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'

export const ProductTypeParams = z.object({ productType: ProductType })

const StoredDefinitions = z.array(AttributeDefinition)

/** Schema thuộc tính hiện tại của một nhóm hàng; migration seed đủ năm nhóm hàng nên luôn có. */
export async function loadAttributeSchema(db: DbClient, productType: ProductType) {
  const row = await db.attributeSchema.findUniqueOrThrow({ where: { productType } })
  return { productType, attributes: StoredDefinitions.parse(row.attributes), updatedAt: row.updatedAt }
}

/**
 * Như `loadAttributeSchema` nhưng khóa dòng schema tới hết transaction: người sửa schema dùng `FOR UPDATE`,
 * người ghi sản phẩm dùng `FOR SHARE`, để sản phẩm không lọt qua bước kiểm vi phạm khi schema đang đổi.
 */
export async function lockAttributeSchema(
  tx: Prisma.TransactionClient,
  productType: ProductType,
  mode: 'update' | 'share',
) {
  const lock = Prisma.raw(mode === 'update' ? 'FOR UPDATE' : 'FOR SHARE')
  await tx.$executeRaw`SELECT 1 FROM "attribute_schema" WHERE "product_type" = ${productType}::"product_type" ${lock}`
  return loadAttributeSchema(tx, productType)
}

/** Kiểm giá trị thuộc tính theo schema; sai thì ném lỗi 400 kèm lỗi theo từng trường. */
export function assertAttributes(
  definitions: readonly AttributeDefinition[],
  level: AttributeLevel,
  input: Record<string, unknown>,
  path?: string,
): AttributeValues {
  const result = checkAttributes(definitions, level, input, path)
  if (!result.ok) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Thuộc tính không hợp lệ', result.fields)
  return result.values
}

/**
 * Sản phẩm (kể cả nháp, đã lưu trữ) có thuộc tính của chính nó hoặc của một biến thể không còn hợp lệ với schema mới.
 * Mọi lần đổi schema đều đi qua đây, nên thêm thuộc tính bắt buộc, xóa thuộc tính hay bớt giá trị enum đều bị chặn
 * khi có dữ liệu vi phạm.
 * Gọi khi đang giữ khóa `FOR UPDATE` trên dòng schema, nên không sản phẩm nào được ghi chen vào.
 */
export async function findViolatingProducts(
  tx: Prisma.TransactionClient,
  productType: ProductType,
  definitions: readonly AttributeDefinition[],
): Promise<{ id: string; name: string }[]> {
  const products = await tx.product.findMany({
    where: { productType },
    select: { id: true, name: true, attributes: true, variants: { select: { attributes: true } } },
    orderBy: { name: 'asc' },
  })
  const valid = (level: AttributeLevel, attributes: Prisma.JsonValue) =>
    checkAttributes(definitions, level, attributes as Record<string, unknown>).ok
  return products
    .filter((p) => !valid('product', p.attributes) || p.variants.some((v) => !valid('variant', v.attributes)))
    .map(({ id, name }) => ({ id, name }))
}
