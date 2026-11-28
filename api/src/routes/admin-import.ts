import { randomUUID } from 'node:crypto'
import { Router, type Request } from 'express'
import { ErrorCode, type ImportIssue, type ImportPreview, type ImportResult } from '@ecommerce/shared'
import { audited, type AuditEntry } from '../core/audit/audited.ts'
import { currentStaff, hasPermission, requirePermission } from '../core/middleware/staff-context.ts'
import {
  ALREADY_LEDGERED,
  type PlannedOpening,
  type Reference,
  buildTemplate,
  hasOpeningStock,
  hasPrices,
  loadReference,
  planImport,
  readWorkbook,
} from '../catalog/import.ts'
import { productAuditFields, variantCreatedAudits } from '../catalog/products.ts'
import type { Db } from '../core/db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError, conflictField, rethrowUnique } from '../core/errors.ts'
import { receiveFile, requiredFile } from '../core/media/upload.ts'
import { changeStock } from '../stock/stock.ts'
import { contextOf } from '../core/context/request-context.ts'

const MAX_BYTES = 5 * 1024 * 1024
const receiveImportFile = receiveFile(MAX_BYTES, 'File import tối đa 5 MB')
/** Import runs up to a few thousand statements in one transaction; Prisma's 5 s default is not enough. */
const IMPORT_TIMEOUT_MS = 120_000

/**
 * Reads the file and blocks it entirely when prices are filled without `price.edit` or opening stock without
 * `stock.adjust`: import is no back door for changing prices or stock.
 */
async function readUpload(req: Request, ref: Reference) {
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

/** 400 for a file that still has errors at confirm (nothing written); error paths read `<sheet> / <row> / <column>`. */
function invalidImportFile(errors: ImportIssue[]) {
  const fields = errors.map((e) => ({
    path: [e.sheet, e.row, e.column].filter((p) => p !== null).join(' / '),
    message: e.message,
  }))
  return new AppError(400, ErrorCode.VALIDATION_ERROR, 'File còn lỗi, chưa ghi gì; hãy xem trước để sửa', fields)
}

/**
 * Writes opening stock via `changeStock` after the new variants exist. "No ledger rows yet" is rechecked under the
 * lock, since rows may have appeared since the preview. Returns the `stock.opening` audit entries.
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
  // The SKU may have just changed on the product page after the preview.
  const missing = openings.filter((o) => !idOf.has(o.sku))
  if (missing.length) {
    throw invalidImportFile(
      missing.map((o) => ({
        sheet: o.sheet,
        row: o.row,
        column: 'SKU',
        message: 'SKU không còn tồn tại; hãy xem trước lại',
      })),
    )
  }
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

/** Import products and variants from an .xlsx file; everything needs `catalog.edit`. */
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
        contextOf(req),
        async (tx, audit) => {
          // Keep attribute schemas, brands and categories still until the transaction ends, as for single product
          // writes.
          await tx.$executeRaw`SELECT 1 FROM "attribute_schema" FOR SHARE`
          await tx.$executeRaw`SELECT 1 FROM "brand" FOR KEY SHARE`
          await tx.$executeRaw`SELECT 1 FROM "category" FOR KEY SHARE`
          const ref = await loadReference(tx)
          const { rows, errors: structure, fileName } = await readUpload(req, ref)
          const plan = await planImport(tx, rows, ref)
          const errors = [...structure, ...plan.errors]
          if (errors.length) throw invalidImportFile(errors)
          // Nothing to create and no opening stock (every row's SKU already exists): write nothing, audit included.
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
              entries.push(...variantCreatedAudits(variant))
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
