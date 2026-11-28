import { randomUUID } from 'node:crypto'
import { ErrorCode, type ImportIssue, type ImportPreview, type ImportResult } from '@ecommerce/shared'
import { audited, type AuditEntry } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { AppError, conflictField, rethrowUnique } from '../../core/errors.ts'
import { Prisma } from '../../generated/prisma/client.ts'
import { productAuditFields, variantCreatedAudits } from '../product/index.ts'
import type { ImportFile, ProductImportPorts } from './product-import.interface.ts'
import {
  ALREADY_LEDGERED,
  buildTemplate,
  hasOpeningStock,
  hasPrices,
  loadReference,
  planImport,
  readWorkbook,
  type PlannedOpening,
  type Reference,
} from './product-import.plan.ts'
import type { ProductImportRepository } from './product-import.repository.ts'

/** Import runs up to a few thousand statements in one transaction; Prisma's 5 s default is not enough. */
const IMPORT_TIMEOUT_MS = 120_000

/** 400 for a file that still has errors at confirm (nothing written); error paths read `<sheet> / <row> / <column>`. */
function invalidImportFile(errors: ImportIssue[]) {
  const fields = errors.map((e) => ({
    path: [e.sheet, e.row, e.column].filter((p) => p !== null).join(' / '),
    message: e.message,
  }))
  return new AppError(400, ErrorCode.VALIDATION_ERROR, 'File còn lỗi, chưa ghi gì; hãy xem trước để sửa', fields)
}

/** Products and variants from an .xlsx file: template, preview (nothing written), commit (all or nothing). */
export class ProductImportService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: ProductImportRepository,
    private readonly ports: ProductImportPorts,
  ) {}

  async template() {
    return buildTemplate(await loadReference(this.prisma, this.ports.schemas))
  }

  /**
   * Reads the file and blocks it entirely when prices are filled without `price.edit` or opening stock without
   * `stock.adjust`: import is no back door for changing prices or stock.
   */
  private async read(file: ImportFile, ref: Reference) {
    const read = await readWorkbook(file.buffer, ref)
    if (hasPrices(read.rows) && !file.canEditPrice) {
      throw new AppError(
        403,
        ErrorCode.FORBIDDEN,
        'File có điền giá nhưng bạn không có quyền sửa giá; xóa các cột giá hoặc nhờ người có quyền',
      )
    }
    if (hasOpeningStock(read.rows) && !file.canAdjustStock) {
      throw new AppError(
        403,
        ErrorCode.FORBIDDEN,
        'File có điền tồn đầu kỳ nhưng bạn không có quyền điều chỉnh tồn; xóa cột tồn đầu kỳ hoặc nhờ người có quyền',
      )
    }
    return read
  }

  async preview(file: ImportFile): Promise<ImportPreview> {
    const ref = await loadReference(this.prisma, this.ports.schemas)
    const { rows, errors: structure } = await this.read(file, ref)
    const plan = await planImport(this.prisma, rows, ref)
    return {
      products: plan.products.length,
      variants: plan.products.reduce((n, p) => n + p.variants.length, 0),
      openingStocks: plan.openings.length,
      errors: [...structure, ...plan.errors],
      warnings: plan.warnings,
    }
  }

  /** Rechecks the file under the reference locks and writes everything in one audited transaction. */
  async commit(file: ImportFile, ctx: RequestContext): Promise<ImportResult> {
    return audited(
      this.prisma,
      ctx,
      async (tx, audit) => {
        await this.repo.lockReferences(tx)
        const ref = await loadReference(tx, this.ports.schemas)
        const { rows, errors: structure } = await this.read(file, ref)
        const plan = await planImport(tx, rows, ref)
        const errors = [...structure, ...plan.errors]
        if (errors.length) throw invalidImportFile(errors)
        // Nothing to create and no opening stock (every row's SKU already exists): write nothing, audit included.
        if (plan.products.length === 0 && plan.openings.length === 0) {
          return { products: 0, variants: 0, openingStocks: 0 }
        }

        const products = plan.products.map(({ variants, ...p }) => ({ ...p, id: randomUUID(), variants }))
        if (products.length) {
          await this.repo.createProducts(
            tx,
            products.map(({ variants: _variants, ...p }) => ({ ...p, sizeChart: Prisma.DbNull })),
            products.flatMap((p) => p.variants.map((v) => ({ ...v, productId: p.id }))),
          )
        }
        const openingEntries = await this.recordOpeningStocks(tx, ctx.staffId, plan.openings)

        const created = await this.repo.createdProducts(
          tx,
          products.map((p) => p.id),
        )
        const entries: AuditEntry[] = []
        for (const product of created) {
          entries.push({
            action: 'catalog.product.create',
            entityType: 'product',
            entityId: product.id,
            after: productAuditFields(product),
          })
          for (const variant of product.variants) entries.push(...variantCreatedAudits(variant))
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
          after: { fileName: file.fileName, ...summary },
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
  }

  /**
   * Writes opening stock through the stock port after the new variants exist. "No ledger rows yet" is rechecked under
   * the lock, since rows may have appeared since the preview. Returns the `stock.opening` audit entries.
   */
  private async recordOpeningStocks(
    tx: Prisma.TransactionClient,
    actorId: string,
    openings: PlannedOpening[],
  ): Promise<AuditEntry[]> {
    if (openings.length === 0) return []
    const variants = await this.repo.variantIdsBySku(
      tx,
      openings.map((o) => o.sku),
    )
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
    const { movements } = await this.ports.stock.change(tx, actorId, [...idOf.values()], async () => {
      const ledgered = await this.repo.ledgeredVariants(tx, [...idOf.values()])
      const late = openings.filter((o) => ledgered.some((m) => m.variantId === idOf.get(o.sku)))
      if (late.length) {
        throw invalidImportFile(
          late.map((o) => ({ sheet: o.sheet, row: o.row, column: 'Tồn đầu kỳ', message: ALREADY_LEDGERED })),
        )
      }
      return openings.map((o) => ({
        variantId: idOf.get(o.sku)!,
        quantity: o.quantity,
        kind: 'opening' as const,
        path: 'file',
      }))
    })
    return movements.map((m) => ({
      action: 'stock.opening',
      entityType: 'product_variant',
      entityId: m.variantId,
      after: { sku: skuOf.get(m.variantId)!, onHand: m.onHandAfter },
    }))
  }
}
