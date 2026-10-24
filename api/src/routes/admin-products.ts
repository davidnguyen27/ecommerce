import { isDeepStrictEqual } from 'node:util'
import { Router, type Request } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  ProductRequest,
  VariantRequest,
  type AdminProductList,
  type AdminVariant,
  type AttributeValues,
  type PolicyPageOptionList,
} from '@ecommerce/shared'
import { audited, type Audit } from '../audit/audited.ts'
import { currentStaff, forbidden, hasPermission, requirePermission } from '../auth/staff-context.ts'
import { assertAttributes, lockAttributeSchema } from '../catalog/attribute-schemas.ts'
import {
  ProductParams,
  lockProduct,
  priceAuditFields,
  productAuditFields,
  toAdminProduct,
  toAdminVariant,
  toNumber,
  variantAuditFields,
} from '../catalog/products.ts'
import { loadDraft, loadLiveVersion, publishPrice, toAdminProductDetail } from '../catalog/publication.ts'
import type { Db } from '../db.ts'
import { Prisma, type ProductVariant } from '../generated/prisma/client.ts'
import { AppError, conflictField, invalidField, rethrowUnique } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

const VariantParams = z.object({ id: z.uuid(), variantId: z.uuid() })

/** Slug là unique constraint duy nhất của sản phẩm ngoài khóa chính. */
const slugTaken = () => conflictField('slug', 'Slug này đã có sản phẩm khác dùng')
const skuTaken = () => conflictField('sku', 'SKU này đã có biến thể khác dùng')

/**
 * Sản phẩm và biến thể. Xem cần `catalog.edit` hoặc `price.edit` (người chỉ sửa giá cũng phải thấy biến thể);
 * soạn sản phẩm, biến thể cần `catalog.edit`; đổi giá cần `price.edit`.
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
      // Khai báo trước `/:id`. Tiêu đề là bản đang soạn: đây là màn hình nhân viên, không phải khách.
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
            // Đổi nhóm hàng sẽ làm sai thuộc tính của mọi biến thể, nên nhóm hàng cố định từ lúc tạo.
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
        const created = await audited(prisma, req, (tx, audit) => createVariant(tx, audit, req, id, input))
        res.status(201).json(created)
      })
      // Người chỉ có `price.edit` cũng dùng route này để đổi giá, gửi kèm các trường khác không đổi.
      .put('/:id/variants/:variantId', requirePermission('catalog.edit', 'price.edit'), async (req, res) => {
        const { id, variantId } = parse(VariantParams, req.params)
        const input = parse(VariantRequest, req.body)
        const updated = await audited(prisma, req, (tx, audit) => updateVariant(tx, audit, req, id, variantId, input))
        res.json(updated)
      })
  )
}

type VariantInput = z.output<typeof VariantRequest>
type LockedProduct = Awaited<ReturnType<typeof lockProduct>>
type VariantFields = Pick<ProductVariant, 'sku' | 'status' | 'sortOrder'> & { attributes: AttributeValues }
type VariantPrice = { price: number | null; compareAtPrice: number | null }

/** Tạo biến thể (route đã yêu cầu `catalog.edit`); gửi kèm giá cần thêm `price.edit` và ghi audit `price.change`. */
async function createVariant(
  tx: Prisma.TransactionClient,
  audit: Audit,
  req: Request,
  productId: string,
  input: VariantInput,
): Promise<AdminVariant> {
  const product = await lockProduct(tx, productId)
  const { others, fields } = await resolveFields(tx, product, null, input)
  const price = { price: input.price ?? null, compareAtPrice: input.compareAtPrice ?? null }
  const priced = price.price !== null || price.compareAtPrice !== null
  if (priced && !hasPermission(req, 'price.edit')) throw forbidden()
  // Biến thể mới chưa có trên website: phiên bản đang xuất bản không có nó.
  await assertVariant(tx, product, others, null, fields, price, false)

  const created = await tx.productVariant
    .create({ data: { ...fields, ...price, productId } })
    .catch(rethrowUnique(skuTaken))
  await audit({
    action: 'catalog.variant.create',
    entityType: 'product_variant',
    entityId: created.id,
    after: variantAuditFields(created),
  })
  if (priced) {
    await audit({
      action: 'price.change',
      entityType: 'product_variant',
      entityId: created.id,
      before: priceAuditFields({ ...created, price: null, compareAtPrice: null }),
      after: priceAuditFields(created),
    })
  }
  return toAdminVariant(created)
}

/**
 * Sửa biến thể. Đổi SKU, thuộc tính, trạng thái, thứ tự cần `catalog.edit`; gửi kèm giá khác giá hiện tại cần
 * `price.edit`, mỗi lần đổi giá ghi một bản audit `price.change` riêng, và biến thể đang có trên website thì
 * giá mới lên website ngay qua một phiên bản xuất bản mới.
 */
async function updateVariant(
  tx: Prisma.TransactionClient,
  audit: Audit,
  req: Request,
  productId: string,
  variantId: string,
  input: VariantInput,
): Promise<AdminVariant> {
  const product = await lockProduct(tx, productId)
  const before = product.variants.find((v) => v.id === variantId)
  if (!before) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy biến thể')
  const { others, fields } = await resolveFields(tx, product, before, input)
  const price = {
    price: input.price === undefined ? toNumber(before.price) : input.price,
    compareAtPrice: input.compareAtPrice === undefined ? toNumber(before.compareAtPrice) : input.compareAtPrice,
  }
  const current = variantAuditFields(before)
  const fieldsChanged = !isDeepStrictEqual(current, { productId, ...fields })
  const priceChanged =
    price.price !== toNumber(before.price) || price.compareAtPrice !== toNumber(before.compareAtPrice)

  if (fieldsChanged && !hasPermission(req, 'catalog.edit')) throw forbidden()
  if (priceChanged && !hasPermission(req, 'price.edit')) throw forbidden()
  if (!fieldsChanged && !priceChanged) return toAdminVariant(before)

  const live = await loadLiveVersion(tx, product.liveVersionId)
  const onWebsite = live?.snapshot.variants.some((v) => v.id === before.id) ?? false
  await assertVariant(tx, product, others, before, fields, price, onWebsite)

  const after = await tx.productVariant
    .update({ where: { id: before.id }, data: { ...fields, ...price } })
    .catch(rethrowUnique(skuTaken))
  if (fieldsChanged) {
    await audit({
      action: 'catalog.variant.update',
      entityType: 'product_variant',
      entityId: after.id,
      before: current,
      after: variantAuditFields(after),
    })
  }
  if (priceChanged) {
    await audit({
      action: 'price.change',
      entityType: 'product_variant',
      entityId: after.id,
      before: priceAuditFields(before),
      after: priceAuditFields(after),
    })
    if (live && onWebsite && price.price !== null) {
      const variant = { id: after.id, price: price.price, compareAtPrice: price.compareAtPrice }
      const version = await publishPrice(tx, productId, live.snapshot, variant, currentStaff(req).id)
      await audit({
        action: 'catalog.product.publish',
        entityType: 'product',
        entityId: productId,
        before: { status: product.status, liveVersion: live.version },
        after: { status: product.status, liveVersion: version.version },
      })
    }
  }
  return toAdminVariant(after)
}

/** Trường không phải giá sau khi áp `input` lên `before` (null khi tạo); thuộc tính kiểm theo schema dưới khóa. */
async function resolveFields(
  tx: Prisma.TransactionClient,
  product: LockedProduct,
  before: ProductVariant | null,
  input: VariantInput,
) {
  const others = product.variants.filter((v) => v.id !== before?.id)
  const schema = await lockAttributeSchema(tx, product.productType, 'share')
  const fields: VariantFields = {
    sku: input.sku,
    attributes: assertAttributes(schema.attributes, 'variant', input.attributes),
    status: input.status,
    sortOrder: input.sortOrder ?? before?.sortOrder ?? Math.max(-1, ...others.map((v) => v.sortOrder)) + 1,
  }
  return { others, fields }
}

/** Ràng buộc nghiệp vụ của biến thể sắp lưu; `onWebsite` là biến thể có trong phiên bản khách đang thấy. */
async function assertVariant(
  tx: Prisma.TransactionClient,
  product: LockedProduct,
  others: ProductVariant[],
  before: ProductVariant | null,
  fields: VariantFields,
  price: VariantPrice,
  onWebsite: boolean,
) {
  if (price.compareAtPrice !== null && (price.price === null || price.compareAtPrice < price.price)) {
    throw invalidField('compareAtPrice', 'Giá hãng phải để trống hoặc không thấp hơn giá bán')
  }
  if (others.some((v) => isDeepStrictEqual(v.attributes, fields.attributes))) {
    throw conflictField('attributes', 'Sản phẩm đã có biến thể với tổ hợp thuộc tính này')
  }
  // Tổ hợp đã kiểm dưới khóa sản phẩm; unique còn lại khi ghi chỉ có thể là SKU vừa được sản phẩm khác dùng.
  if (fields.sku !== before?.sku && (await tx.productVariant.findUnique({ where: { sku: fields.sku } }))) {
    throw skuTaken()
  }
  if (product.status !== 'published') return
  const stillSelling = others.some((v) => v.status === 'active')
  if (before?.status === 'active' && fields.status !== 'active' && !stillSelling) {
    throw conflictField(
      'status',
      'Đây là biến thể đang bán cuối cùng của sản phẩm đã xuất bản; muốn thôi bán thì lưu trữ sản phẩm',
    )
  }
  if (price.price === null && (fields.status === 'active' || onWebsite)) {
    throw conflictField('price', 'Biến thể của sản phẩm đã xuất bản phải có giá bán')
  }
}

/** Danh mục sản phẩm được gắn vào, giữ khóa tới hết transaction để không bị xóa giữa chừng; không có thì 400. */
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
