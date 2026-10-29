import { describe, expect, it } from 'vitest'
import { OWNER, bearer, createStaff, type Request } from './support/staff.ts'
import { adjust, movementsOf, onHandOf, warehouse } from './support/stock.ts'

const receive = (request: Request, token: string, body: Record<string, unknown>) =>
  request.post('/api/admin/stock/receipts').set(bearer(token)).send(body)

const RECEIPT = {
  supplierName: 'Nike Singapore',
  receivedOn: '2026-10-28',
  note: 'Lô hàng tháng 10',
  lines: [
    { sku: 'AM90-40', quantity: 5 },
    { sku: 'am90-41', quantity: 3 },
  ],
}

describe('phiếu nhập kho', () => {
  it('tạo phiếu làm tăng tồn từng biến thể, sổ ghi mỗi dòng kèm phiếu, và xem lại được chi tiết phiếu', async () => {
    const { request, token, v40, v41 } = await warehouse()
    await adjust(request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 2, expectedOnHand: 0 })

    const res = await receive(request, token, RECEIPT)
    const detail = await request.get(`/api/admin/stock/receipts/${res.body.id}`).set(bearer(token))
    const movements = await movementsOf(request, token, { kind: 'receipt' })

    expect(res.status).toBe(201)
    expect(detail.body).toEqual({
      id: res.body.id,
      supplierName: 'Nike Singapore',
      receivedOn: '2026-10-28',
      note: 'Lô hàng tháng 10',
      createdAt: expect.any(String),
      createdBy: expect.objectContaining({ email: OWNER.email }),
      lines: [
        { variantId: v40.id, sku: 'AM90-40', productName: 'Air Max 90', quantity: 5, onHandAfter: 7 },
        { variantId: v41.id, sku: 'AM90-41', productName: 'Air Max 90', quantity: 3, onHandAfter: 3 },
      ],
    })
    expect(await onHandOf(request, token, 'AM90-40')).toBe(7)
    expect(await onHandOf(request, token, 'AM90-41')).toBe(3)
    expect(movements.body.items).toHaveLength(2)
    expect(movements.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'receipt', receiptId: res.body.id, quantity: 5 })]),
    )
  })

  it('một dòng có SKU không tồn tại hoặc trùng thì lỗi theo dòng và không dòng nào được ghi', async () => {
    const { request, token } = await warehouse()

    const missing = await receive(request, token, {
      ...RECEIPT,
      lines: [
        { sku: 'AM90-40', quantity: 5 },
        { sku: 'KHONG-CO', quantity: 1 },
      ],
    })
    const duplicate = await receive(request, token, {
      ...RECEIPT,
      lines: [
        { sku: 'AM90-40', quantity: 5 },
        { sku: 'AM90-40', quantity: 2 },
      ],
    })
    const list = await request.get('/api/admin/stock/receipts').set(bearer(token))

    expect(missing.status).toBe(400)
    expect(missing.body.error.fields).toEqual([expect.objectContaining({ path: 'lines.1.sku' })])
    expect(duplicate.status).toBe(400)
    expect(duplicate.body.error.fields).toEqual([expect.objectContaining({ path: 'lines.1.sku' })])
    expect(await onHandOf(request, token, 'AM90-40')).toBe(0)
    expect(list.body.items).toEqual([])
  })

  it('nhập được cho biến thể ngừng bán của sản phẩm nháp', async () => {
    const { request, token, product, v41 } = await warehouse()
    await request
      .put(`/api/admin/products/${product.id}/variants/${v41.id}`)
      .set(bearer(token))
      .send({ sku: 'AM90-41', attributes: { mau: 'Đen', size: '41' }, status: 'discontinued' })

    const res = await receive(request, token, { ...RECEIPT, lines: [{ sku: 'AM90-41', quantity: 4 }] })

    expect(res.status).toBe(201)
    expect(await onHandOf(request, token, 'AM90-41')).toBe(4)
  })

  it('nhiều phiếu cùng biến thể chạy song song cho tổng đúng', async () => {
    const { request, token } = await warehouse()

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        receive(request, token, {
          ...RECEIPT,
          lines: [
            { sku: 'AM90-41', quantity: 2 },
            { sku: 'AM90-40', quantity: 1 },
          ],
        }),
      ),
    )

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201])
    expect(await onHandOf(request, token, 'AM90-40')).toBe(5)
    expect(await onHandOf(request, token, 'AM90-41')).toBe(10)
  })

  it('danh sách phiếu mới nhất trước, có số dòng và tổng số lượng; mỗi phiếu ghi một audit', async () => {
    const { request, token } = await warehouse()
    await receive(request, token, { ...RECEIPT, supplierName: 'Lô 1' })
    await receive(request, token, { ...RECEIPT, supplierName: 'Lô 2', lines: [{ sku: 'AM90-40', quantity: 10 }] })

    const list = await request.get('/api/admin/stock/receipts').set(bearer(token))
    const audit = await request.get('/api/admin/audit').query({ entityType: 'stock_receipt' }).set(bearer(token))

    expect(list.body.items.map((r: { supplierName: string; lineCount: number; totalQuantity: number }) => r)).toEqual([
      expect.objectContaining({ supplierName: 'Lô 2', lineCount: 1, totalQuantity: 10 }),
      expect.objectContaining({ supplierName: 'Lô 1', lineCount: 2, totalQuantity: 8 }),
    ])
    expect(audit.body.items).toHaveLength(2)
    expect(audit.body.items[0]).toMatchObject({
      action: 'stock.receipt.create',
      // Lô 1 đã nhập 5 đôi AM90-40.
      after: { supplierName: 'Lô 2', lines: [{ sku: 'AM90-40', quantity: 10, onHandAfter: 15 }] },
    })
  })
})

describe('quyền và tính chỉ ghi thêm', () => {
  it('không có stock.adjust thì không tạo được phiếu nhưng vẫn xem được', async () => {
    const { request, token } = await warehouse()
    const sales = await createStaff(request, token, ['sales'], 'sales@example.com')
    const created = await receive(request, token, RECEIPT)

    expect((await receive(request, sales.accessToken, RECEIPT)).status).toBe(403)
    expect((await request.get('/api/admin/stock/receipts').set(bearer(sales.accessToken))).status).toBe(200)
    expect(
      (await request.get(`/api/admin/stock/receipts/${created.body.id}`).set(bearer(sales.accessToken))).status,
    ).toBe(200)
  })

  it('không sửa hay xóa được phiếu nhập, kể cả bằng SQL trực tiếp; phiếu không có thì 404', async () => {
    const { request, token, prisma } = await warehouse()
    await receive(request, token, RECEIPT)

    await expect(prisma.$executeRaw`UPDATE "stock_receipt" SET "note" = 'sửa'`).rejects.toThrow(/chỉ cho phép thêm mới/)
    await expect(prisma.$executeRaw`DELETE FROM "stock_receipt"`).rejects.toThrow(/chỉ cho phép thêm mới/)
    expect(
      (await request.get('/api/admin/stock/receipts/00000000-0000-4000-8000-000000000000').set(bearer(token))).status,
    ).toBe(404)
  })
})
