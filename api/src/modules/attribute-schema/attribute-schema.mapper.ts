import type { AdminAttributeSchema, AttributeSchema } from '@ecommerce/shared'
import type { LoadedSchema } from './attribute-schema.interface.ts'

export function toAdminAttributeSchema({ productType, attributes, updatedAt }: LoadedSchema): AdminAttributeSchema {
  return { productType, attributes, updatedAt: updatedAt.toISOString() }
}

export function toPublicAttributeSchema({ productType, attributes }: LoadedSchema): AttributeSchema {
  return { productType, attributes }
}
