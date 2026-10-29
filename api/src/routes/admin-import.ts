import { randomUUID } from 'node:crypto'
import { Router, type Request } from 'express'
import { ErrorCode, type ImportIssue, type ImportPreview, type ImportResult } from '@ecommerce/shared'
import { audited, type AuditEntry } from '../audit/audited.ts'
import { currentStaff, hasPermission, requirePermission } from '../auth/staff-context.ts'
import {
  ALREADY_LEDGERED,
  type PlannedOpening,
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

/** 400 cho file còn lỗi khi xác nhận (không ghi gì); đường dẫn lỗi dạng `<sheet> / <dòng> / <cột>`. */
function invalidImportFile(errors: ImportIssue[]) {
  const fields = errors.map((e) => ({
    path: [e.sheet, e.row, e.column].filter((p) => p !== null).join(' / '),
    message: e.message,
  }))
  return new AppError(400, ErrorCode.VALIDATION_ERROR, 'File còn lỗi, chưa ghi gì; hãy xem trước để sửa', fields)
}

/**
 * Ghi tồn đầu kỳ qua `changeStock`, sau khi biến thể mới đã được tạo. Điều kiện "chưa có dòng sổ" được kiểm lại
 * dưới khóa, vì có thể đã có dòng sổ từ lúc xem trước tới giờ. Trả các bản audit `stock.opening`.
 */
async function recordOpeningStocks(
  tx: Prisma.TransactionClient,
  actorId: string,
  openings: PlannedOpening[],
): Promise<AuditEntry[]> {
  if (openings.length === 0) return []
  const variants = await tx.productVariant.findMany({
    where: { sku: { in: openings.map((o) => o.sku) } },
    select: { id: true, sku: true },
  })
  const idOf = new Map(variants.map((v) => [v.sku, v.id]))
  const skuOf = new Map(variants.map((v) => [v.id, v.sku]))
  const { movements } = await changeStock(tx, actorId, [...idOf.values()], async () => {
    const ledgered = await tx.stockMovement.findMany({
      where: { variantId: { in: [...idOf.values()] } },
      select: { variantId: true },
      distinct: ['variantId'],
    })
    const late = openings.filter((o) => ledgered.some((m) => m.variantId === idOf.get(o.sku)))
    if (late.length) {
      throw invalidImportFile(
        late.map((o) => ({ sheet: o.sheet, row: o.row, column: 'Tồn đầu kỳ', message: ALREADY_LEDGERED })),
      )
    }
    return openings.map((o) => ({ variantId: idOf.get(o.sku)!, quantity: o.quantity, kind: 'opening', path: 'file' }))
  })
  return movements.map((m) => ({
    action: 'stock.opening',
    entityType: 'product_variant',
    entityId: m.variantId,
    after: { sku: skuOf.get(m.variantId)!, onHand: m.onHandAfter },
  }))
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
        openingStocks: plan.openings.length,
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
          if (errors.length) throw invalidImportFile(errors)
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
              data: products.flatMap((p) => p.variants.map((v) => ({ ...v, productId: p.id }))),
            })
          }
          const openingEntries = await recordOpeningStocks(tx, currentStaff(req).id, plan.openings)

          const created = await tx.product.findMany({
            where: { id: { in: products.map((p) => p.id) } },
            include: { variants: { orderBy: { sortOrder: 'asc' } } },
          })
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
          entries.push(...openingEntries)
          const summary = {
            products: created.length,
            variants: created.reduce((n, p) => n + p.variants.length, 0),
            openingStocks: openingEntries.length,
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
