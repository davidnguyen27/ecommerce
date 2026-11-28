import { isDeepStrictEqual } from 'node:util'
import { Router, type Request } from 'express'
import { z } from 'zod'
import { ProductRequest, VariantRequest, type AdminProductList, type PolicyPageOptionList } from '@ecommerce/shared'
import { audited } from '../core/audit/audited.ts'
import { currentStaff, hasPermission, requirePermission } from '../core/middleware/staff-context.ts'
import { assertAttributes, lockAttributeSchema } from '../catalog/attribute-schemas.ts'
import { ProductParams, lockProduct, productAuditFields, toAdminProduct } from '../catalog/products.ts'
import { loadDraft, toAdminProductDetail } from '../catalog/publication.ts'
import { createVariant, updateVariant, type VariantActor } from '../catalog/variants.ts'
import type { Db } from '../core/db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { conflictField, invalidField, rethrowUnique } from '../core/errors.ts'
import { parse } from '../core/middleware/validation.ts'

const VariantParams = z.object({ id: z.uuid(), variantId: z.uuid() })

/** Slug is the product's only unique constraint besides the primary key. */
const slugTaken = () => conflictField('slug', 'Slug này đã có sản phẩm khác dùng')

/** The signed-in staff member as a variant editor. */
const variantActor = (req: Request): VariantActor => ({
  staffId: currentStaff(req).id,
  canEditCatalog: hasPermission(req, 'catalog.edit'),
  canEditPrice: hasPermission(req, 'price.edit'),
})

/**
 * Products and variants. Viewing needs `catalog.edit` or `price.edit` (price-only editors must see variants); editing
 * products and variants needs `catalog.edit`; changing prices `price.edit`.
 */
export function adminProductRoutes(prisma: Db) {
  return (
    Router()
      .use(requirePermission('catalog.edit', 'price.edit'))
      .get('/', async (_req, res) => {
        const products = await prisma.product.findMany({
          include: {
            brand: { select: { id: true, name: true } },
            category: { select: { id: true, name: true } },
            _count: { select: { variants: true } },
          },
          orderBy: { updatedAt: 'desc' },
        })
        const body: AdminProductList = {
          items: products.map((p) => ({
            id: p.id,
            productType: p.productType,
            name: p.name,
            slug: p.slug,
            modelCode: p.modelCode,
            brand: p.brand,
            category: p.category,
            status: p.status,
            variantCount: p._count.variants,
            updatedAt: p.updatedAt.toISOString(),
          })),
        }
        res.json(body)
      })
      // Before `/:id`. Titles are the draft: this is a staff screen, not the customer's.
      .get('/policy-pages', async (_req, res) => {
        const pages = await prisma.contentPage.findMany({
          where: { kind: 'policy' },
          include: { _count: { select: { versions: true } } },
          orderBy: { createdAt: 'asc' },
        })
        const body: PolicyPageOptionList = {
          items: pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, published: p._count.versions > 0 })),
        }
        res.json(body)
      })
      .get('/:id', async (req, res) => {
        const { id } = parse(ProductParams, req.params)
        res.json(toAdminProductDetail(await loadDraft(prisma, id)))
      })
      .post('/', requirePermission('catalog.edit'), async (req, res) => {
        const input = parse(ProductRequest, req.body)
        const created = await audited(prisma, req, async (tx, audit) => {
          const category = await lockCategory(tx, input.categoryId)
          await assertBrandExists(tx, input.brandId)
          const schema = await lockAttributeSchema(tx, category.productType, 'share')
          const product = await tx.product.create({
            data: {
              ...input,
              productType: category.productType,
              sizeChart: input.sizeChart ?? Prisma.DbNull,
              attributes: assertAttributes(schema.attributes, 'product', input.attributes),
            },
            include: { variants: true },
          })
          await audit({
            action: 'catalog.product.create',
            entityType: 'product',
            entityId: product.id,
            after: productAuditFields(product),
          })
          return product
        }).catch(rethrowUnique(slugTaken))
        res.status(201).json(toAdminProduct(created))
      })
      .put('/:id', requirePermission('catalog.edit'), async (req, res) => {
        const { id } = parse(ProductParams, req.params)
        const input = parse(ProductRequest, req.body)
        const updated = await audited(prisma, req, async (tx, audit) => {
          const before = await lockProduct(tx, id)
          if (input.categoryId !== before.categoryId) {
            const category = await lockCategory(tx, input.categoryId)
            // Changing the product type would break every variant's attributes, so it is fixed at creation.
            if (category.productType !== before.productType) {
              throw conflictField('categoryId', 'Chỉ chuyển được sang danh mục cùng nhóm hàng')
            }
          }
          if (input.brandId !== before.brandId) await assertBrandExists(tx, input.brandId)
          const schema = await lockAttributeSchema(tx, before.productType, 'share')
          const attributes = assertAttributes(schema.attributes, 'product', input.attributes)

          const { productType, status } = before
          if (isDeepStrictEqual(productAuditFields(before), { productType, ...input, attributes, status }))
            return before
          const after = await tx.product.update({
            where: { id },
            data: { ...input, sizeChart: input.sizeChart ?? Prisma.DbNull, attributes },
            include: { variants: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } },
          })
          await audit({
            action: 'catalog.product.update',
            entityType: 'product',
            entityId: id,
            before: productAuditFields(before),
            after: productAuditFields(after),
          })
          return after
        }).catch(rethrowUnique(slugTaken))
        res.json(toAdminProduct(updated))
      })
      .post('/:id/variants', requirePermission('catalog.edit'), async (req, res) => {
        const { id } = parse(ProductParams, req.params)
        const input = parse(VariantRequest, req.body)
        const created = await audited(prisma, req, (tx, audit) =>
          createVariant(tx, audit, variantActor(req), id, input),
        )
        res.status(201).json(created)
      })
      // Price-only editors also use this route to change prices, sending the other fields unchanged.
      .put('/:id/variants/:variantId', requirePermission('catalog.edit', 'price.edit'), async (req, res) => {
        const { id, variantId } = parse(VariantParams, req.params)
        const input = parse(VariantRequest, req.body)
        const updated = await audited(prisma, req, (tx, audit) =>
          updateVariant(tx, audit, variantActor(req), id, variantId, input),
        )
        res.json(updated)
      })
  )
}

/** The product's category, locked until the transaction ends so it is not deleted midway; missing gives 400. */
async function lockCategory(tx: Prisma.TransactionClient, categoryId: string) {
  await tx.$executeRaw`SELECT 1 FROM "category" WHERE "id" = ${categoryId}::uuid FOR KEY SHARE`
  const category = await tx.category.findUnique({ where: { id: categoryId } })
  if (!category) throw invalidField('categoryId', 'Danh mục không tồn tại')
  return category
}

async function assertBrandExists(tx: Prisma.TransactionClient, brandId: string) {
  if (!(await tx.brand.findUnique({ where: { id: brandId } }))) {
    throw invalidField('brandId', 'Thương hiệu không tồn tại')
  }
}
