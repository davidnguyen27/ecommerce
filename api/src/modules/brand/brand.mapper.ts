import type { AdminBrand, PublicBrand } from '@ecommerce/shared'
import type { Storage } from '../../core/adapters/storage.ts'
import { StoredImage, imageRenditions } from '../../core/media/images.ts'
import type { Brand } from '../../generated/prisma/client.ts'

export const logoOf = (brand: Brand) => (brand.logo === null ? null : StoredImage.parse(brand.logo))

export function toAdminBrand(storage: Storage, brand: Brand): AdminBrand {
  const logo = logoOf(brand)
  return {
    id: brand.id,
    slug: brand.slug,
    name: brand.name,
    description: brand.description,
    hidden: brand.hidden,
    logo: logo && imageRenditions(storage, logo),
    updatedAt: brand.updatedAt.toISOString(),
  }
}

export function toPublicBrand(storage: Storage, brand: Brand): PublicBrand {
  const logo = logoOf(brand)
  return {
    slug: brand.slug,
    name: brand.name,
    description: brand.description,
    logo: logo && imageRenditions(storage, logo),
  }
}

/** Business fields recorded in audit. */
export function brandAuditFields({ slug, name, description, hidden }: Brand) {
  return { slug, name, description, hidden }
}
