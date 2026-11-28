import type { Request, Response } from 'express'
import type {
  AdminAttributeSchema,
  AdminAttributeSchemaList,
  AttributeSchema,
  ValidateAttributesResponse,
} from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import { ProductTypeParams, UpdateAttributeSchemaDto, ValidateAttributesDto } from './dto/index.ts'
import { toAdminAttributeSchema, toPublicAttributeSchema } from './attribute-schema.mapper.ts'
import type { AttributeSchemaService } from './attribute-schema.service.ts'

/** Routes read the product type from the URL before the body, as they always did. */
export class AttributeSchemaController {
  constructor(private readonly service: AttributeSchemaService) {}

  list = async (_req: Request, res: Response) => {
    const body: AdminAttributeSchemaList = { items: (await this.service.list()).map(toAdminAttributeSchema) }
    res.json(body)
  }

  get = async (req: Request, res: Response) => {
    const { productType } = parse(ProductTypeParams, req.params)
    const body: AdminAttributeSchema = toAdminAttributeSchema(await this.service.get(productType))
    res.json(body)
  }

  update = async (req: Request, res: Response) => {
    const { productType } = parse(ProductTypeParams, req.params)
    const { attributes } = parse(UpdateAttributeSchemaDto, req.body)
    const body: AdminAttributeSchema = toAdminAttributeSchema(
      await this.service.update(productType, attributes, contextOf(req)),
    )
    res.json(body)
  }

  validate = async (req: Request, res: Response) => {
    const { productType } = parse(ProductTypeParams, req.params)
    const { level, attributes } = parse(ValidateAttributesDto, req.body)
    const body: ValidateAttributesResponse = { attributes: await this.service.validate(productType, level, attributes) }
    res.json(body)
  }

  publicGet = async (req: Request, res: Response) => {
    const { productType } = parse(ProductTypeParams, req.params)
    const body: AttributeSchema = toPublicAttributeSchema(await this.service.get(productType))
    res.json(body)
  }
}
