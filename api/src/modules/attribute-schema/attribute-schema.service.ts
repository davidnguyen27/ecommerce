import { isDeepStrictEqual } from 'node:util'
import {
  ErrorCode,
  ProductType,
  checkAttributes,
  type AttributeDefinition,
  type AttributeLevel,
} from '@ecommerce/shared'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { AppError } from '../../core/errors.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type { LoadedSchema } from './attribute-schema.interface.ts'
import { assertAttributes, type AttributeSchemaQuery } from './attribute-schema.query.ts'
import type { AttributeSchemaRepository } from './attribute-schema.repository.ts'

/** Attribute schemas per product type: view, edit (blocked by existing data that would break), validate values. */
export class AttributeSchemaService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: AttributeSchemaRepository,
    private readonly query: AttributeSchemaQuery,
  ) {}

  list() {
    return Promise.all(ProductType.options.map((type) => this.query.load(this.prisma, type)))
  }

  get(productType: ProductType) {
    return this.query.load(this.prisma, productType)
  }

  /** The same attributes write nothing. */
  async update(
    productType: ProductType,
    attributes: AttributeDefinition[],
    ctx: RequestContext,
  ): Promise<LoadedSchema> {
    return audited(this.prisma, ctx, async (tx, audit) => {
      const before = await this.query.lock(tx, productType, 'update')
      if (isDeepStrictEqual(before.attributes, attributes)) return before

      const violating = await this.findViolatingProducts(tx, productType, attributes)
      if (violating.length) {
        throw new AppError(
          409,
          ErrorCode.CONFLICT,
          'Schema mới làm sai thuộc tính của sản phẩm đang có',
          violating.map(({ id, name }) => ({
            path: `products.${id}`,
            message: `Sản phẩm "${name}" vi phạm schema mới`,
          })),
        )
      }
      await this.repo.update(tx, productType, attributes)
      await audit({
        action: 'catalog.attribute_schema.update',
        entityType: 'attribute_schema',
        entityId: productType,
        before: { attributes: before.attributes },
        after: { attributes },
      })
      return this.query.load(tx, productType)
    })
  }

  async validate(productType: ProductType, level: AttributeLevel, attributes: Record<string, unknown>) {
    const schema = await this.query.load(this.prisma, productType)
    return assertAttributes(schema.attributes, level, attributes)
  }

  /**
   * Products (drafts and archived too) whose own or variant attributes no longer fit the new schema. Every schema
   * change goes through here, so adding a required attribute, removing one or dropping enum values is blocked by
   * existing data. Call while holding `FOR UPDATE` on the schema row, so no product write can slip in.
   */
  private async findViolatingProducts(
    tx: Prisma.TransactionClient,
    productType: ProductType,
    definitions: readonly AttributeDefinition[],
  ): Promise<{ id: string; name: string }[]> {
    const products = await this.repo.productsOfType(tx, productType)
    const valid = (level: AttributeLevel, attributes: Prisma.JsonValue) =>
      checkAttributes(definitions, level, attributes as Record<string, unknown>).ok
    return products
      .filter((p) => !valid('product', p.attributes) || p.variants.some((v) => !valid('variant', v.attributes)))
      .map(({ id, name }) => ({ id, name }))
  }
}
