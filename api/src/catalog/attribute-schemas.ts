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
 * Sản phẩm và biến thể của nhóm hàng không còn hợp lệ với schema mới. Mọi lần đổi schema đều đi qua đây,
 * nên thêm thuộc tính bắt buộc, xóa thuộc tính hay bớt giá trị enum đều bị chặn khi có dữ liệu vi phạm.
 * Chưa có sản phẩm nên luôn rỗng; ticket 09 kiểm từng sản phẩm và biến thể bằng `checkAttributes`.
 */
export async function findViolatingProducts(
  _tx: Prisma.TransactionClient,
  _productType: ProductType,
  _definitions: readonly AttributeDefinition[],
): Promise<{ id: string; name: string }[]> {
  return []
}
