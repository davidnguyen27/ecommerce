import { describe, expect, it } from 'vitest'
import { OWNER, bearer, createStaff } from './support/staff.ts'
import { adjust, movementsOf, onHandOf, warehouse } from './support/stock.ts'

describe('điều chỉnh tồn', () => {
  it('kiểm kê ghi số đếm thực tế: tồn bằng số đếm, sổ xuất nhập ghi chênh lệch và tồn sau', async () => {
    const { request, token, v40 } = await warehouse()

    const res = await adjust(request, token, {
      variantId: v40.id,
      reason: 'stocktake',
      countedQuantity: 5,
      expectedOnHand: 0,
    })
    const movements = await request.get('/api/admin/stock/movements').query({ variantId: v40.id }).set(bearer(token))

    expect(res.status).toBe(201)
    expect(await onHandOf(request, token, 'AM90-40')).toBe(5)
    expect(movements.body.items).toEqual([
      expect.objectContaining({
        kind: 'adjustment',
        reason: 'stocktake',
        quantity: 5,
        onHandAfter: 5,
        variant: { id: v40.id, sku: 'AM90-40' },
        actor: expect.objectContaining({ email: OWNER.email }),
      }),
    ])
  })
})

describe('các lý do điều chỉnh', () => {
  it('kiểm kê bằng đúng tồn hiện tại thì không ghi sổ, không ghi audit và trả 200', async () => {
    const { request, token, v40 } = await warehouse()

    const res = await adjust(request, token, {
      variantId: v40.id,
      reason: 'stocktake',
      countedQuantity: 0,
      expectedOnHand: 0,
    })
    const movements = await movementsOf(request, token)
    const audit = await request.get('/api/admin/audit').query({ entityType: 'product_variant' }).set(bearer(token))

    expect(res.status).toBe(200)
    expect(res.body.onHand).toBe(0)
    expect(movements.body.items).toEqual([])
    expect(audit.body.items.map((e: { action: string }) => e.action)).not.toContain('stock.adjust')
  })

  it('hàng hỏng và mất hàng giảm tồn đúng số lượng gửi lên', async () => {
    const { request, token, v40 } = await warehouse()
    await adjust(request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 10, expectedOnHand: 0 })

    const damaged = await adjust(request, token, {
      variantId: v40.id,
      reason: 'damaged',
      quantity: 2,
      expectedOnHand: 10,
    })
    const lost = await adjust(request, token, { variantId: v40.id, reason: 'lost', quantity: 3, expectedOnHand: 8 })
    const movements = await movementsOf(request, token, { variantId: v40.id })

    expect(damaged.status).toBe(201)
    expect(lost.body.onHand).toBe(5)
    expect(movements.body.items).toEqual([
      expect.objectContaining({ reason: 'lost', quantity: -3, onHandAfter: 5 }),
      expect.objectContaining({ reason: 'damaged', quantity: -2, onHandAfter: 8 }),
      expect.objectContaining({ reason: 'stocktake', quantity: 10, onHandAfter: 10 }),
    ])
  })

  it('lý do "khác" nhận số tăng hoặc giảm, và bị từ chối khi thiếu ghi chú', async () => {
    const { request, token, v40 } = await warehouse()

    const missingNote = await adjust(request, token, {
      variantId: v40.id,
      reason: 'other',
      quantity: 4,
      expectedOnHand: 0,
    })
    const up = await adjust(request, token, {
      variantId: v40.id,
      reason: 'other',
      quantity: 4,
      expectedOnHand: 0,
      note: 'Hàng mẫu trưng bày trả về kho',
    })
    const down = await adjust(request, token, {
      variantId: v40.id,
      reason: 'other',
      quantity: -1,
      expectedOnHand: 4,
      note: 'Tặng khách VIP',
    })

    expect(missingNote.status).toBe(400)
    expect(missingNote.body.error.fields).toEqual([expect.objectContaining({ path: 'note' })])
    expect(up.status).toBe(201)
    expect(down.body.onHand).toBe(3)
  })

  it('điều chỉnh làm tồn âm bị từ chối 409, tồn giữ nguyên', async () => {
    const { request, token, v40 } = await warehouse()
    await adjust(request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 1, expectedOnHand: 0 })

    const res = await adjust(request, token, { variantId: v40.id, reason: 'damaged', quantity: 2, expectedOnHand: 1 })

    expect(res.status).toBe(409)
    expect(res.body.error.fields).toEqual([expect.objectContaining({ path: 'quantity' })])
    expect(await onHandOf(request, token, 'AM90-40')).toBe(1)
  })

  it('tồn đã đổi so với lúc mở form thì bị từ chối 409 kèm số tồn mới, không ghi gì', async () => {
    const { request, token, v40 } = await warehouse()
    await adjust(request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 6, expectedOnHand: 0 })

    const res = await adjust(request, token, {
      variantId: v40.id,
      reason: 'stocktake',
      countedQuantity: 3,
      expectedOnHand: 0,
    })
    const movements = await movementsOf(request, token, { variantId: v40.id })

    expect(res.status).toBe(409)
    expect(res.body.error.message).toContain('6')
    expect(res.body.error.details).toEqual({ onHand: 6 })
    expect(movements.body.items).toHaveLength(1)
    expect(await onHandOf(request, token, 'AM90-40')).toBe(6)
  })

  it('điều chỉnh được biến thể của sản phẩm nháp và biến thể ngừng bán', async () => {
    const { request, token, product, v41 } = await warehouse()
    const discontinue = await request
      .put(`/api/admin/products/${product.id}/variants/${v41.id}`)
      .set(bearer(token))
      .send({ sku: 'AM90-41', attributes: { mau: 'Đen', size: '41' }, status: 'discontinued' })
    expect(discontinue.status).toBe(200)

    const res = await adjust(request, token, {
      variantId: v41.id,
      reason: 'stocktake',
      countedQuantity: 2,
      expectedOnHand: 0,
    })

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ sku: 'AM90-41', status: 'discontinued', onHand: 2, product: { status: 'draft' } })
  })

  it('biến thể không tồn tại thì lỗi theo trường', async () => {
    const { request, token } = await warehouse()

    const res = await adjust(request, token, {
      variantId: '00000000-0000-4000-8000-000000000000',
      reason: 'lost',
      quantity: 1,
      expectedOnHand: 0,
    })

    expect(res.status).toBe(400)
    expect(res.body.error.fields).toEqual([expect.objectContaining({ path: 'variantId' })])
  })
})

describe('đồng thời', () => {
  it('nhiều lần giảm song song cùng dựa trên một số tồn thì chỉ một lần được ghi', async () => {
    const { request, token, v40 } = await warehouse()
    await adjust(request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 3, expectedOnHand: 0 })

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        adjust(request, token, { variantId: v40.id, reason: 'lost', quantity: 1, expectedOnHand: 3 }),
      ),
    )

    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(4)
    expect(await onHandOf(request, token, 'AM90-40')).toBe(2)
  })
})

describe('quyền, audit và sổ xuất nhập', () => {
  it('chỉ người có stock.adjust mới điều chỉnh được; người soạn danh mục hoặc giá vẫn xem được tồn và sổ', async () => {
    const { request, token, v40 } = await warehouse()
    const sales = await createStaff(request, token, ['sales'], 'sales@example.com')
    const accountant = await createStaff(request, token, ['accountant'], 'ke-toan@example.com')
    const kho = await createStaff(request, token, ['warehouse'], 'kho@example.com')
    const body = { variantId: v40.id, reason: 'stocktake', countedQuantity: 1, expectedOnHand: 0 }

    expect((await adjust(request, sales.accessToken, body)).status).toBe(403)
    expect((await adjust(request, accountant.accessToken, body)).status).toBe(403)
    expect((await adjust(request, kho.accessToken, body)).status).toBe(201)
    for (const staff of [sales, accountant]) {
      expect((await request.get('/api/admin/stock').set(bearer(staff.accessToken))).status).toBe(200)
      expect((await movementsOf(request, staff.accessToken)).status).toBe(200)
    }
  })

  it('mỗi lần điều chỉnh ghi audit stock.adjust có tồn trước, tồn sau, lý do và ghi chú', async () => {
    const { request, token, v40 } = await warehouse()
    await adjust(request, token, {
      variantId: v40.id,
      reason: 'stocktake',
      countedQuantity: 4,
      expectedOnHand: 0,
      note: 'Kiểm kê tháng 10',
    })

    const audit = await request.get('/api/admin/audit').query({ entityType: 'product_variant' }).set(bearer(token))

    expect(audit.body.items).toContainEqual(
      expect.objectContaining({
        action: 'stock.adjust',
        entityId: v40.id,
        before: { sku: 'AM90-40', onHand: 0 },
        after: { sku: 'AM90-40', onHand: 4, reason: 'stocktake', note: 'Kiểm kê tháng 10' },
      }),
    )
  })

  it('không sửa hay xóa được dòng sổ xuất nhập, kể cả bằng SQL trực tiếp', async () => {
    const { request, token, prisma, v40 } = await warehouse()
    await adjust(request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 4, expectedOnHand: 0 })

    await expect(prisma.$executeRaw`UPDATE "stock_movement" SET "quantity" = 100`).rejects.toThrow(
      /chỉ cho phép thêm mới/,
    )
    await expect(prisma.$executeRaw`DELETE FROM "stock_movement"`).rejects.toThrow(/chỉ cho phép thêm mới/)
    await expect(prisma.$executeRaw`TRUNCATE "stock_movement"`).rejects.toThrow(/chỉ cho phép thêm mới/)
  })

  it('sổ lọc được theo biến thể, theo loại và theo khoảng thời gian', async () => {
    const { request, token, v40, v41 } = await warehouse()
    await adjust(request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 4, expectedOnHand: 0 })
    await adjust(request, token, { variantId: v41.id, reason: 'stocktake', countedQuantity: 2, expectedOnHand: 0 })
    const future = new Date(Date.now() + 60_000).toISOString()

    const byVariant = await movementsOf(request, token, { variantId: v41.id })
    const byKind = await movementsOf(request, token, { kind: 'receipt' })
    const later = await movementsOf(request, token, { from: future })

    expect(byVariant.body.items.map((m: { variant: { sku: string } }) => m.variant.sku)).toEqual(['AM90-41'])
    expect(byKind.body.items).toEqual([])
    expect(later.body.items).toEqual([])
  })
})

describe('danh sách tồn', () => {
  it('tìm theo SKU hoặc tên sản phẩm và sắp xếp theo tồn', async () => {
    const { request, token, v40, v41 } = await warehouse()
    await adjust(request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 7, expectedOnHand: 0 })
    await adjust(request, token, { variantId: v41.id, reason: 'stocktake', countedQuantity: 1, expectedOnHand: 0 })
    const list = (query: Record<string, string>) => request.get('/api/admin/stock').query(query).set(bearer(token))

    const asc = await list({ sort: 'on_hand_asc' })
    const desc = await list({ sort: 'on_hand_desc' })
    const byName = await list({ q: 'air max' })
    const bySku = await list({ q: 'am90-41' })

    expect(asc.body.items.map((i: { sku: string }) => i.sku)).toEqual(['AM90-41', 'AM90-40'])
    expect(desc.body.items.map((i: { sku: string }) => i.sku)).toEqual(['AM90-40', 'AM90-41'])
    expect(byName.body.total).toBe(2)
    expect(bySku.body.items).toEqual([
      expect.objectContaining({
        sku: 'AM90-41',
        onHand: 1,
        status: 'active',
        product: expect.objectContaining({ name: 'Air Max 90', productType: 'footwear' }),
        brand: expect.objectContaining({ name: 'Nike' }),
      }),
    ])
  })

  it('trang soạn sản phẩm có tồn của từng biến thể', async () => {
    const { request, token, product, v40 } = await warehouse()
    await adjust(request, token, { variantId: v40.id, reason: 'stocktake', countedQuantity: 3, expectedOnHand: 0 })

    const detail = await request.get(`/api/admin/products/${product.id}`).set(bearer(token))

    expect(detail.body.variants.map((v: { sku: string; onHand: number }) => [v.sku, v.onHand])).toEqual([
      ['AM90-40', 3],
      ['AM90-41', 0],
    ])
  })
})
