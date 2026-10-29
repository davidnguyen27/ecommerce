import { Router } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  STOCK_VIEW_PERMISSIONS,
  StockReceiptQuery,
  StockReceiptRequest,
  type FieldError,
  type StockReceipt,
  type StockReceiptPage,
} from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import { changeStock } from '../stock/stock.ts'

const ReceiptParams = z.object({ id: z.uuid() })
const CREATED_BY = { select: { id: true, name: true, email: true } } as const

/** Ngày hàng về lưu kiểu DATE; trả về dạng `YYYY-MM-DD`. */
const dateOnly = (date: Date) => date.toISOString().slice(0, 10)

async function loadReceipt(prisma: Db, id: string): Promise<StockReceipt> {
  const receipt = await prisma.stockReceipt.findUnique({
    where: { id },
    include: {
      createdBy: CREATED_BY,
      movements: {
        include: { variant: { select: { id: true, sku: true, product: { select: { name: true } } } } },
        orderBy: { seq: 'asc' },
      },
    },
  })
  if (!receipt) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy phiếu nhập')
  return {
    id: receipt.id,
    supplierName: receipt.supplierName,
    receivedOn: dateOnly(receipt.receivedOn),
    note: receipt.note,
    createdAt: receipt.createdAt.toISOString(),
    createdBy: receipt.createdBy,
    lines: receipt.movements.map((m) => ({
      variantId: m.variant.id,
      sku: m.variant.sku,
      productName: m.variant.product.name,
      quantity: m.quantity,
      onHandAfter: m.onHandAfter,
    })),
  }
}

/**
 * Phiếu nhập kho, mount tại `/stock/receipts`. Xem cùng quyền với trang tồn; tạo phiếu cần `stock.adjust`.
 * Không có endpoint sửa hay xóa: nhập sai thì làm điều chỉnh.
 */
export function adminStockReceiptRoutes(prisma: Db) {
  return Router()
    .use(requirePermission(...STOCK_VIEW_PERMISSIONS))
    .get('/', async (req, res) => {
      const query = parse(StockReceiptQuery, req.query)
      const [receipts, total] = await Promise.all([
        prisma.stockReceipt.findMany({
          include: { createdBy: CREATED_BY, movements: { select: { quantity: true } } },
          orderBy: { seq: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.stockReceipt.count(),
      ])
      const body: StockReceiptPage = {
        items: receipts.map((r) => ({
          id: r.id,
          supplierName: r.supplierName,
          receivedOn: dateOnly(r.receivedOn),
          note: r.note,
          createdAt: r.createdAt.toISOString(),
          createdBy: r.createdBy,
          lineCount: r.movements.length,
          totalQuantity: r.movements.reduce((sum, m) => sum + m.quantity, 0),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
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
      const variants = await prisma.productVariant.findMany({
        where: { sku: { in: input.lines.map((l) => l.sku) } },
        select: { id: true, sku: true },
      })
      const idOf = new Map(variants.map((v) => [v.sku, v.id]))
      const fields: FieldError[] = []
      const firstLine = new Map<string, number>()
      input.lines.forEach(({ sku }, index) => {
        const path = `lines.${index}.sku`
        if (firstLine.has(sku)) fields.push({ path, message: `SKU ${sku} trùng với dòng ${firstLine.get(sku)! + 1}` })
        else if (!idOf.has(sku)) fields.push({ path, message: `Không có biến thể nào có SKU ${sku}` })
        firstLine.set(sku, firstLine.get(sku) ?? index)
      })
      if (fields.length) throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Phiếu nhập có dòng không hợp lệ', fields)

      const actorId = currentStaff(req).id
      const id = await audited(prisma, req, async (tx, audit) => {
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
          },
        })
        return receipt.id
      })
      const body: StockReceipt = await loadReceipt(prisma, id)
      res.status(201).json(body)
    })
}
