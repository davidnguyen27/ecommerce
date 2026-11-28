import { z } from 'zod'
import {
  AttributeDefinition,
  ErrorCode,
  checkAttributes,
  type AttributeLevel,
  type AttributeValues,
  type ProductType,
} from '@ecommerce/shared'
import type { DbClient } from '../../core/db.ts'
import { AppError } from '../../core/errors.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type { IAttributeSchemaQuery, LoadedSchema } from './attribute-schema.interface.ts'
import type { AttributeSchemaRepository } from './attribute-schema.repository.ts'

const StoredDefinitions = z.array(AttributeDefinition)

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

/** Read side of the attribute schemas; reads only through the `db` it is given. */
export class AttributeSchemaQuery implements IAttributeSchemaQuery {
  constructor(private readonly repo: AttributeSchemaRepository) {}

  async load(db: DbClient, productType: ProductType): Promise<LoadedSchema> {
    const row = await this.repo.findOrThrow(db, productType)
    return { productType, attributes: StoredDefinitions.parse(row.attributes), updatedAt: row.updatedAt }
  }

  async lock(tx: Prisma.TransactionClient, productType: ProductType, mode: 'update' | 'share') {
    await this.repo.lock(tx, productType, mode)
    return this.load(tx, productType)
  }
}
