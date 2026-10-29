import { randomUUID } from 'node:crypto'
import { Router, type Request } from 'express'
import { ErrorCode, type ImportIssue, type ImportPreview, type ImportResult } from '@ecommerce/shared'
import { audited, type AuditEntry } from '../audit/audited.ts'
import { currentStaff, hasPermission, requirePermission } from '../auth/staff-context.ts'
import {
  ALREADY_LEDGERED,
  buildTemplate,
  hasOpeningStock,
  hasPrices,
  loadReference,
  planImport,
  readWorkbook,
} from '../catalog/import.ts'
import { priceAuditFields, productAuditFields, variantAuditFields } from '../catalog/products.ts'
import type { Db } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError, conflictField, rethrowUnique } from '../http/errors.ts'
import { receiveFile, requiredFile } from '../media/upload.ts'
import { changeStock } from '../stock/stock.ts'

const MAX_BYTES = 5 * 1024 * 1024
const receiveImportFile = receiveFile(MAX_BYTES, 'File import tối đa 5 MB')
/** Import tối đa vài nghìn câu lệnh trong một transaction; mặc định 5 giây của Prisma không đủ. */
const IMPORT_TIMEOUT_MS = 120_000

/**
 * Đọc file và chặn cả file khi có điền giá mà thiếu `price.edit`, hoặc có điền tồn đầu kỳ mà thiếu `stock.adjust`:
 * import không thành cửa sau để đổi giá hay tồn.
 */
async function readUpload(req: Request, ref: Awaited<ReturnType<typeof loadReference>>) {
  const file = requiredFile(req, 'Chọn file Excel .xlsx để import')
  const read = await readWorkbook(file.buffer, ref)
  if (hasPrices(read.rows) && !hasPermission(req, 'price.edit')) {
    throw new AppError(
      403,
      ErrorCode.FORBIDDEN,
      'File có điền giá nhưng bạn không có quyền sửa giá; xóa các cột giá hoặc nhờ người có quyền',
    )
  }
  if (hasOpeningStock(read.rows) && !hasPermission(req, 'stock.adjust')) {
    throw new AppError(
      403,
      ErrorCode.FORBIDDEN,
      'File có điền tồn đầu kỳ nhưng bạn không có quyền điều chỉnh tồn; xóa cột tồn đầu kỳ hoặc nhờ người có quyền',
    )
  }
  return { ...read, fileName: file.originalname }
}

/** Lỗi của file khi xác nhận: không ghi gì; đường dẫn lỗi dạng `<sheet> / <dòng> / <cột>`. */
function fileHasErrors(errors: ImportIssue[]) {
  const fields = errors.map((e) => ({
    path: [e.sheet, e.row, e.column].filter((p) => p !== null).join(' / '),
    message: e.message,
  }))
  return new AppError(400, ErrorCode.VALIDATION_ERROR, 'File còn lỗi, chưa ghi gì; hãy xem trước để sửa', fields)
}

/** Import sản phẩm và biến thể bằng file .xlsx; mọi thao tác cần `catalog.edit`. */
export function adminImportRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('catalog.edit'))
    .get('/template', async (_req, res) => {
      const file = await buildTemplate(await loadReference(prisma))
      res
        .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .attachment('mau-import-hang-hoa.xlsx')
        .send(file)
    })
    .post('/preview', receiveImportFile, async (req, res) => {
      const ref = await loadReference(prisma)
      const { rows, errors: structure } = await readUpload(req, ref)
      const plan = await planImport(prisma, rows, ref)
      const body: ImportPreview = {
        products: plan.products.length,
        variants: plan.products.reduce((n, p) => n + p.variants.length, 0),
        openingStocks: plan.openingStocks,
        errors: [...structure, ...plan.errors],
        warnings: plan.warnings,
      }
      res.json(body)
    })
    .post('/commit', receiveImportFile, async (req, res) => {
      const result = await audited(
        prisma,
        req,
        async (tx, audit) => {
          // Giữ schema thuộc tính, thương hiệu và danh mục đứng yên tới hết transaction, như khi ghi sản phẩm từng cái.
          await tx.$executeRaw`SELECT 1 FROM "attribute_schema" FOR SHARE`
          await tx.$executeRaw`SELECT 1 FROM "brand" FOR KEY SHARE`
          await tx.$executeRaw`SELECT 1 FROM "category" FOR KEY SHARE`
          const ref = await loadReference(tx)
          const { rows, errors: structure, fileName } = await readUpload(req, ref)
          const plan = await planImport(tx, rows, ref)
          const errors = [...structure, ...plan.errors]
          if (errors.length) throw fileHasErrors(errors)
          // Không tạo gì và không có tồn đầu kỳ (mọi dòng có SKU đã tồn tại): không ghi gì, kể cả audit.
          if (plan.products.length === 0 && plan.openings.length === 0) {
            return { products: 0, variants: 0, openingStocks: 0 }
          }

          const products = plan.products.map(({ variants, ...p }) => ({ ...p, id: randomUUID(), variants }))
          if (products.length) {
            await tx.product.createMany({
              data: products.map(({ variants: _variants, ...p }) => ({ ...p, sizeChart: Prisma.DbNull })),
            })
            await tx.productVariant.createMany({
              data: products.flatMap((p) =>
                p.variants.map(({ openingStock: _o, sheet: _s, row: _r, ...v }) => ({ ...v, productId: p.id })),
              ),
            })
          }

          const created = await tx.product.findMany({
            where: { id: { in: products.map((p) => p.id) } },
            include: { variants: { orderBy: { sortOrder: 'asc' } } },
          })
          const createdIds = new Map(created.flatMap((p) => p.variants.map((v) => [v.sku, v.id])))
          const openings = [
            ...plan.openings,
            ...products.flatMap((p) =>
              p.variants
                .filter((v) => v.openingStock > 0)
                .map((v) => ({
                  variantId: createdIds.get(v.sku)!,
                  sku: v.sku,
                  quantity: v.openingStock,
                  sheet: v.sheet,
                  row: v.row,
                })),
            ),
          ]
          const actorId = currentStaff(req).id
          const { movements } = await changeStock(
            tx,
            actorId,
            openings.map((o) => o.variantId),
            async () => {
              // Tồn đầu kỳ chỉ một lần: kiểm lại dưới khóa, vì có thể đã có dòng sổ từ lúc xem trước tới giờ.
              const ledgered = new Set(
                (
                  await tx.stockMovement.findMany({
                    where: { variantId: { in: openings.map((o) => o.variantId) } },
                    select: { variantId: true },
                    distinct: ['variantId'],
                  })
                ).map((m) => m.variantId),
              )
              const late = openings.filter((o) => ledgered.has(o.variantId))
              if (late.length) {
                throw fileHasErrors(
                  late.map((o) => ({ sheet: o.sheet, row: o.row, column: 'Tồn đầu kỳ', message: ALREADY_LEDGERED })),
                )
              }
              return openings.map((o) => ({
                variantId: o.variantId,
                quantity: o.quantity,
                kind: 'opening',
                path: 'file',
              }))
            },
          )
          const skuOf = new Map(openings.map((o) => [o.variantId, o.sku]))

          const entries: AuditEntry[] = []
          for (const product of created) {
            entries.push({
              action: 'catalog.product.create',
              entityType: 'product',
              entityId: product.id,
              after: productAuditFields(product),
            })
            for (const variant of product.variants) {
              entries.push({
                action: 'catalog.variant.create',
                entityType: 'product_variant',
                entityId: variant.id,
                after: variantAuditFields(variant),
              })
              if (variant.price !== null || variant.compareAtPrice !== null) {
                entries.push({
                  action: 'price.change',
                  entityType: 'product_variant',
                  entityId: variant.id,
                  before: priceAuditFields({ ...variant, price: null, compareAtPrice: null }),
                  after: priceAuditFields(variant),
                })
              }
            }
          }
          for (const m of movements) {
            entries.push({
              action: 'stock.opening',
              entityType: 'product_variant',
              entityId: m.variantId,
              after: { sku: skuOf.get(m.variantId)!, onHand: m.onHandAfter },
            })
          }
          const summary = {
            products: created.length,
            variants: created.reduce((n, p) => n + p.variants.length, 0),
            openingStocks: movements.length,
          }
          entries.push({
            action: 'catalog.import',
            entityType: 'import',
            entityId: randomUUID(),
            after: { fileName, ...summary },
          })
          await audit(entries)
          return summary
        },
        { timeout: IMPORT_TIMEOUT_MS },
      ).catch(
        rethrowUnique(() =>
          conflictField('file', 'Slug hoặc SKU vừa được tạo ở nơi khác trong lúc import; hãy xem trước lại'),
        ),
      )
      const body: ImportResult = result
      res.status(body.products > 0 || body.openingStocks > 0 ? 201 : 200).json(body)
    })
}
