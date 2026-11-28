import { Router } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  STOCK_VIEW_PERMISSIONS,
  StockReceiptQuery,
  StockReceiptPreviewRequest,
  StockReceiptRequest,
  type StockReceiptPreview,
  type AuditActor,
  type FieldError,
  type StockReceipt,
  type StockReceiptPage,
} from '@ecommerce/shared'
import { ACTOR_SELECT, audited } from '../core/audit/audited.ts'
import { currentStaff, requirePermission } from '../core/middleware/staff-context.ts'
import type { Db } from '../core/db.ts'
import type { StockReceipt as StockReceiptRow } from '../generated/prisma/client.ts'
import { AppError } from '../core/errors.ts'
import { pageWindow } from '../core/pagination.ts'
import { parse } from '../core/middleware/validation.ts'
import type { EmailQueue } from '../core/jobs/jobs.ts'
import { applyArrivals, planArrivals } from '../preorders/arrivals.ts'
import { changeStock } from '../stock/stock.ts'
import { contextOf } from '../core/context/request-context.ts'

const ReceiptParams = z.object({ id: z.uuid() })

type ReceiptRow = Pick<StockReceiptRow, 'id' | 'supplierName' | 'receivedOn' | 'note' | 'createdAt'> & {
  createdBy: AuditActor
}

/** Receipt header shared by list and detail; arrival date is a DATE, returned as `YYYY-MM-DD`. */
const toReceiptHeader = (r: ReceiptRow) => ({
  id: r.id,
  supplierName: r.supplierName,
  receivedOn: r.receivedOn.toISOString().slice(0, 10),
  note: r.note,
  createdAt: r.createdAt.toISOString(),
  createdBy: r.createdBy,
})

async function loadReceipt(prisma: Db, id: string): Promise<StockReceipt> {
  const receipt = await prisma.stockReceipt.findUnique({
    where: { id },
    include: {
      createdBy: { select: ACTOR_SELECT },
      movements: {
        include: { variant: { select: { id: true, sku: true, product: { select: { name: true } } } } },
        orderBy: { seq: 'asc' },
      },
    },
  })
  if (!receipt) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy phiếu nhập')
  return {
    ...toReceiptHeader(receipt),
    lines: receipt.movements.map((m) => ({
      variantId: m.variant.id,
      sku: m.variant.sku,
      productName: m.variant.product.name,
      quantity: m.quantity,
      onHandAfter: m.onHandAfter,
    })),
  }
}

/** Variant ids by SKU for the receipt lines; duplicate or unknown SKUs give 400 per line. */
async function resolveLines(prisma: Db, lines: readonly { sku: string }[]) {
  const variants = await prisma.productVariant.findMany({
    where: { sku: { in: lines.map((l) => l.sku) } },
    select: { id: true, sku: true },
  })
  const idOf = new Map(variants.map((v) => [v.sku, v.id]))
  const fields: FieldError[] = []
  const firstLine = new Map<string, number>()
  lines.forEach(({ sku }, index) => {
    const path = `lines.${index}.sku`
    if (firstLine.has(sku)) fields.push({ path, message: `SKU ${sku} trùng với dòng ${firstLine.get(sku)! + 1}` })
    else if (!idOf.has(sku)) fields.push({ path, message: `Không có biến thể nào có SKU ${sku}` })
    firstLine.set(sku, firstLine.get(sku) ?? index)
  })
  if (fields.length) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Phiếu nhập có dòng không hợp lệ', fields)
  return idOf
}

/**
 * Stock receipts, mounted at `/stock/receipts`. Viewing has the stock page's permissions; creating and previewing
 * pre-order allocation need `stock.adjust`. No edit or delete: mistakes are fixed with an adjustment.
 */
export function adminStockReceiptRoutes(prisma: Db, mail: { emails: EmailQueue; siteUrl: string }) {
  return Router()
    .use(requirePermission(...STOCK_VIEW_PERMISSIONS))
    .get('/', async (req, res) => {
      const query = parse(StockReceiptQuery, req.query)
      const [receipts, total] = await Promise.all([
        prisma.stockReceipt.findMany({
          include: { createdBy: { select: ACTOR_SELECT }, movements: { select: { quantity: true } } },
          orderBy: { seq: 'desc' },
          ...pageWindow(query),
        }),
        prisma.stockReceipt.count(),
      ])
      const body: StockReceiptPage = {
        items: receipts.map((r) => ({
          ...toReceiptHeader(r),
          lineCount: r.movements.length,
          totalQuantity: r.movements.reduce((sum, m) => sum + m.quantity, 0),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      }
      res.json(body)
    })
    .post('/preview', requirePermission('stock.adjust'), async (req, res) => {
      const input = parse(StockReceiptPreviewRequest, req.body)
      const idOf = await resolveLines(prisma, input.lines)
      const plans = await planArrivals(
        prisma,
        input.lines.map((line) => ({ variantId: idOf.get(line.sku)!, quantity: line.quantity })),
      )
      const body: StockReceiptPreview = {
        lines: input.lines.map((line, index) => {
          const plan = plans[index]!
          return {
            sku: line.sku,
            quantity: line.quantity,
            forPreorders: plan.received - plan.toStock,
            preorderOrders: plan.allocations.length,
            ordersCompleted: plan.allocations.filter((a) => a.fills).length,
            toStock: plan.toStock,
          }
        }),
      }
      res.json(body)
    })
    .get('/:id', async (req, res) => {
      const { id } = parse(ReceiptParams, req.params)
      const body: StockReceipt = await loadReceipt(prisma, id)
      res.json(body)
    })
    .post('/', requirePermission('stock.adjust'), async (req, res) => {
      const input = parse(StockReceiptRequest, req.body)
      const idOf = await resolveLines(prisma, input.lines)

      const actorId = currentStaff(req).id
      const id = await audited(prisma, contextOf(req), async (tx, audit) => {
        const receipt = await tx.stockReceipt.create({
          data: {
            supplierName: input.supplierName,
            receivedOn: new Date(input.receivedOn),
            note: input.note,
            createdById: actorId,
          },
        })
        const { locked, movements } = await changeStock(tx, actorId, [...idOf.values()], () =>
          input.lines.map((line, index) => ({
            variantId: idOf.get(line.sku)!,
            quantity: line.quantity,
            kind: 'receipt',
            receiptId: receipt.id,
            path: `lines.${index}.quantity`,
          })),
        )
        // Arrivals are reserved at once for waiting deposited pre-orders, in the same transaction: never regular stock
        // that another customer could buy (ADR 0013). `changeStock` has locked the variants.
        const plans = await planArrivals(
          tx,
          input.lines.map((line) => ({ variantId: idOf.get(line.sku)!, quantity: line.quantity })),
          { lock: true },
        )
        const arrivedOrderCodes = await applyArrivals(tx, mail, plans, { receiptId: receipt.id })
        const preorderAllocations = plans.flatMap((plan) =>
          plan.allocations.map((a) => ({
            sku: locked.get(plan.variantId)!.sku,
            orderCode: a.orderCode,
            quantity: a.take,
          })),
        )
        await audit({
          action: 'stock.receipt.create',
          entityType: 'stock_receipt',
          entityId: receipt.id,
          after: {
            supplierName: input.supplierName,
            receivedOn: input.receivedOn,
            note: input.note,
            lines: movements.map((m) => ({
              sku: locked.get(m.variantId)!.sku,
              quantity: m.quantity,
              onHandAfter: m.onHandAfter,
            })),
            ...(preorderAllocations.length && { preorderAllocations, arrivedOrderCodes }),
          },
        })
        return receipt.id
      })
      const body: StockReceipt = await loadReceipt(prisma, id)
      res.status(201).json(body)
    })
}
