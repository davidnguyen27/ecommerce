import { z } from 'zod'
import {
  AttributeDefinition,
  ErrorCode,
  ProductType,
  checkAttributes,
  type AttributeLevel,
  type AttributeValues,
} from '@ecommerce/shared'
import type { DbClient } from '../core/db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../core/errors.ts'

export const ProductTypeParams = z.object({ productType: ProductType })

const StoredDefinitions = z.array(AttributeDefinition)

/** Current attribute schema of a product type; the seed migration covers all five types, so it always exists. */
export async function loadAttributeSchema(db: DbClient, productType: ProductType) {
  const row = await db.attributeSchema.findUniqueOrThrow({ where: { productType } })
  return { productType, attributes: StoredDefinitions.parse(row.attributes), updatedAt: row.updatedAt }
}

/**
 * Like `loadAttributeSchema`, but locks the schema row until the transaction ends: schema edits use `FOR UPDATE`,
 * product writes `FOR SHARE`, so no product slips past the violation check while the schema changes.
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

/** Validates attribute values against the schema; throws 400 with per-field errors. */
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
 * Products (drafts and archived too) whose own or variant attributes no longer fit the new schema. Every schema change
 * goes through here, so adding a required attribute, removing one or dropping enum values is blocked by existing data.
 * Call while holding `FOR UPDATE` on the schema row, so no product write can slip in.
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
