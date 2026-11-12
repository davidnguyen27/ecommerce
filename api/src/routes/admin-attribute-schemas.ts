import { isDeepStrictEqual } from 'node:util'
import { Router } from 'express'
import {
  ErrorCode,
  ProductType,
  UpdateAttributeSchemaRequest,
  ValidateAttributesRequest,
  type AdminAttributeSchema,
  type AdminAttributeSchemaList,
  type ValidateAttributesResponse,
} from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import {
  ProductTypeParams,
  assertAttributes,
  findViolatingProducts,
  loadAttributeSchema,
  lockAttributeSchema,
} from '../catalog/attribute-schemas.ts'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

type LoadedSchema = Awaited<ReturnType<typeof loadAttributeSchema>>

function toAdmin({ productType, attributes, updatedAt }: LoadedSchema): AdminAttributeSchema {
  return { productType, attributes, updatedAt: updatedAt.toISOString() }
}

/** Xem và sửa schema thuộc tính của nhóm hàng; mọi route cần `catalog.edit`. */
export function adminAttributeSchemaRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('catalog.edit'))
    .get('/', async (_req, res) => {
      const schemas = await Promise.all(ProductType.options.map((type) => loadAttributeSchema(prisma, type)))
      const body: AdminAttributeSchemaList = { items: schemas.map(toAdmin) }
      res.json(body)
    })
    .get('/:productType', async (req, res) => {
      const { productType } = parse(ProductTypeParams, req.params)
      res.json(toAdmin(await loadAttributeSchema(prisma, productType)))
    })
    .put('/:productType', async (req, res) => {
      const { productType } = parse(ProductTypeParams, req.params)
      const { attributes } = parse(UpdateAttributeSchemaRequest, req.body)
      const updated = await audited(prisma, req, async (tx, audit) => {
        const before = await lockAttributeSchema(tx, productType, 'update')
        if (isDeepStrictEqual(before.attributes, attributes)) return before

        const violating = await findViolatingProducts(tx, productType, attributes)
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
        await tx.attributeSchema.update({ where: { productType }, data: { attributes } })
        await audit({
          action: 'catalog.attribute_schema.update',
          entityType: 'attribute_schema',
          entityId: productType,
          before: { attributes: before.attributes },
          after: { attributes },
        })
        return loadAttributeSchema(tx, productType)
      })
      res.json(toAdmin(updated))
    })
    .post('/:productType/validate', async (req, res) => {
      const { productType } = parse(ProductTypeParams, req.params)
      const { level, attributes } = parse(ValidateAttributesRequest, req.body)
      const schema = await loadAttributeSchema(prisma, productType)
      const body: ValidateAttributesResponse = { attributes: assertAttributes(schema.attributes, level, attributes) }
      res.json(body)
    })
}
