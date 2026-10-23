import { isDeepStrictEqual } from 'node:util'
import { Router, type Request } from 'express'
import { z } from 'zod'
import { ErrorCode, ProductRequest, VariantRequest, type AdminProductList, type AdminVariant } from '@ecommerce/shared'
import { audited, type Audit } from '../audit/audited.ts'
import { forbidden, hasPermission, requirePermission } from '../auth/staff-context.ts'
import { assertAttributes, lockAttributeSchema } from '../catalog/attribute-schemas.ts'
import {
  loadProduct,
  lockProduct,
  priceAuditFields,
  productAuditFields,
  toAdminProduct,
  toAdminVariant,
  toNumber,
  variantAuditFields,
} from '../catalog/products.ts'
import type { Db } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

const ProductParams = z.object({ id: z.uuid() })
const VariantParams = z.object({ id: z.uuid(), variantId: z.uuid() })

const conflict = (path: string, message: string) => new AppError(409, ErrorCode.CONFLICT, message, [{ path, message }])
const invalid = (path: string, message: string) =>
  new AppError(400, ErrorCode.VALIDATION_ERROR, message, [{ path, message }])

const slugTaken = () => conflict('slug', 'Slug này đã có sản phẩm khác dùng')
const skuTaken = () => conflict('sku', 'SKU này đã có biến thể khác dùng')

/** Slug là unique constraint duy nhất của sản phẩm ngoài khóa chính. */
function rethrowSlugTaken(err: unknown): never {
  throw err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? slugTaken() : err
}

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
      .get('/:id', async (req, res) => {
        const { id } = parse(ProductParams, req.params)
        res.json(toAdminProduct(await loadProduct(prisma, id)))
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
        }).catch(rethrowSlugTaken)
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
              throw conflict('categoryId', 'Chỉ chuyển được sang danh mục cùng nhóm hàng')
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
        }).catch(rethrowSlugTaken)
        res.json(toAdminProduct(updated))
      })
      .post('/:id/variants', requirePermission('catalog.edit'), async (req, res) => {
        const { id } = parse(ProductParams, req.params)
        const input = parse(VariantRequest, req.body)
        const created = await audited(prisma, req, (tx, audit) => saveVariant(tx, audit, req, id, null, input))
        res.status(201).json(created)
      })
      // Người chỉ có `price.edit` cũng dùng route này để đổi giá, gửi kèm các trường khác không đổi.
      .put('/:id/variants/:variantId', async (req, res) => {
        const { id, variantId } = parse(VariantParams, req.params)
        const input = parse(VariantRequest, req.body)
        const updated = await audited(prisma, req, (tx, audit) => saveVariant(tx, audit, req, id, variantId, input))
        res.json(updated)
      })
  )
}

/**
 * Tạo (`variantId` null) hoặc sửa một biến thể. Đổi SKU, thuộc tính, trạng thái, thứ tự cần `catalog.edit`;
 * gửi kèm giá khác giá hiện tại cần `price.edit`, và mỗi lần đổi giá ghi một bản audit `price.change` riêng.
 */
async function saveVariant(
  tx: Prisma.TransactionClient,
  audit: Audit,
  req: Request,
  productId: string,
  variantId: string | null,
  input: z.output<typeof VariantRequest>,
): Promise<AdminVariant> {
  const product = await lockProduct(tx, productId)
  const before = variantId === null ? null : product.variants.find((v) => v.id === variantId)
  if (before === undefined) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy biến thể')
  const others = product.variants.filter((v) => v.id !== variantId)

  const schema = await lockAttributeSchema(tx, product.productType, 'share')
  const fields = {
    sku: input.sku,
    attributes: assertAttributes(schema.attributes, 'variant', input.attributes),
    status: input.status,
    sortOrder: input.sortOrder ?? before?.sortOrder ?? Math.max(-1, ...others.map((v) => v.sortOrder)) + 1,
  }
  const price = {
    price: input.price === undefined ? toNumber(before?.price) : input.price,
    compareAtPrice: input.compareAtPrice === undefined ? toNumber(before?.compareAtPrice) : input.compareAtPrice,
  }
  const current = before && variantAuditFields(before)
  const fieldsChanged = !current || !isDeepStrictEqual(current, { productId, ...fields })
  const priceChanged =
    price.price !== toNumber(before?.price) || price.compareAtPrice !== toNumber(before?.compareAtPrice)

  if (fieldsChanged && !hasPermission(req, 'catalog.edit')) throw forbidden()
  if (priceChanged && !hasPermission(req, 'price.edit')) throw forbidden()
  if (!fieldsChanged && !priceChanged) return toAdminVariant(before!)

  if (price.compareAtPrice !== null && (price.price === null || price.compareAtPrice < price.price)) {
    throw invalid('compareAtPrice', 'Giá hãng phải để trống hoặc không thấp hơn giá bán')
  }
  if (others.some((v) => isDeepStrictEqual(v.attributes, fields.attributes))) {
    throw conflict('attributes', 'Sản phẩm đã có biến thể với tổ hợp thuộc tính này')
  }
  if (fields.sku !== before?.sku && (await tx.productVariant.findUnique({ where: { sku: fields.sku } }))) {
    throw skuTaken()
  }
  const stillSelling = others.some((v) => v.status === 'active')
  if (product.status === 'published' && before?.status === 'active' && fields.status !== 'active' && !stillSelling) {
    throw conflict(
      'status',
      'Đây là biến thể đang bán cuối cùng của sản phẩm đã xuất bản; muốn thôi bán thì lưu trữ sản phẩm',
    )
  }

  const data = { ...fields, ...price }
  const after = await (
    before
      ? tx.productVariant.update({ where: { id: before.id }, data })
      : tx.productVariant.create({ data: { ...data, productId } })
  ).catch((err: unknown) => {
    // Tổ hợp đã kiểm dưới khóa sản phẩm; unique còn lại chỉ có thể là SKU vừa được sản phẩm khác dùng.
    throw err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? skuTaken() : err
  })

  if (fieldsChanged) {
    await audit({
      action: before ? 'catalog.variant.update' : 'catalog.variant.create',
      entityType: 'product_variant',
      entityId: after.id,
      ...(current && { before: current }),
      after: variantAuditFields(after),
    })
  }
  if (priceChanged) {
    await audit({
      action: 'price.change',
      entityType: 'product_variant',
      entityId: after.id,
      before: priceAuditFields(before ?? { ...after, price: null, compareAtPrice: null }),
      after: priceAuditFields(after),
    })
  }
  return toAdminVariant(after)
}

/** Danh mục sản phẩm được gắn vào, giữ khóa tới hết transaction để không bị xóa giữa chừng; không có thì 400. */
async function lockCategory(tx: Prisma.TransactionClient, categoryId: string) {
  await tx.$executeRaw`SELECT 1 FROM "category" WHERE "id" = ${categoryId}::uuid FOR KEY SHARE`
  const category = await tx.category.findUnique({ where: { id: categoryId } })
  if (!category) throw invalid('categoryId', 'Danh mục không tồn tại')
  return category
}

async function assertBrandExists(tx: Prisma.TransactionClient, brandId: string) {
  if (!(await tx.brand.findUnique({ where: { id: brandId } }))) {
    throw invalid('brandId', 'Thương hiệu không tồn tại')
  }
}
