import { Router } from 'express'
import type { AttributeSchema } from '@ecommerce/shared'
import { ProductTypeParams, loadAttributeSchema } from '../catalog/attribute-schemas.ts'
import type { Db } from '../core/db.ts'
import { parse } from '../core/middleware/validation.ts'

/** A product type's attribute schema, for website labels and filters. */
export function publicAttributeSchemaRoutes(prisma: Db) {
  return Router().get('/:productType', async (req, res) => {
    const { productType } = parse(ProductTypeParams, req.params)
    const { attributes } = await loadAttributeSchema(prisma, productType)
    const body: AttributeSchema = { productType, attributes }
    res.json(body)
  })
}
