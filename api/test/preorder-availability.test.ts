import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { shop } from './support/shop.ts'
import { bearer } from './support/staff.ts'
import { adjust } from './support/stock.ts'

const DAY = 24 * 60 * 60_000
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString()

type Availability = { sku: string; inStock: boolean; availability: string; preorder: unknown }

/**
 * Cửa hàng có Air Max đã xuất bản: AM-40 còn 3 đôi, AM-41 hết hàng. `open` mở đợt đặt trước cho cả hai biến thể,
 * cọc 30%, giao 10–20/12/2026.
 */
async function preorderShop() {
  const app = await shop()
  const { request, token, product, v40, v41 } = app
  const open = async (
    variants = [
      { variantId: v40.id, allocation: 10 },
      { variantId: v41.id, allocation: 5 },
    ],
  ) => {
    const res = await request
      .post('/api/admin/preorder-campaigns')
      .set(bearer(token))
      .send({
        productId: product.id,
        depositPercent: 30,
        deliveryFrom: '2026-12-10',
        deliveryTo: '2026-12-20',
        closesAt: inDays(14),
        variants,
      })
    expect(res.status).toBe(201)
    return res.body.id as string
  }
  /** Biến thể như khách thấy ở trang sản phẩm, theo SKU. */
  const variants = async () => {
    const res = await request.get('/api/products/air-max')
    expect(res.status).toBe(200)
    return Object.fromEntries((res.body.variants as Availability[]).map((v) => [v.sku, v]))
  }
  /** Thẻ Air Max ở danh sách sản phẩm. */
  const card = async () => {
    const res = await request.get('/api/products')
    expect(res.status).toBe(200)
    return (res.body.items as { slug: string; inStock: boolean; preorder: boolean }[]).find((c) => c.slug === 'air-max')
  }
  /** Đưa tồn AM-40 về `count` đôi bằng một lần kiểm kê. */
  const countV40 = async (count: number, expected = 3) => {
    const res = await adjust(request, token, {
      variantId: v40.id,
      reason: 'stocktake',
      countedQuantity: count,
      expectedOnHand: expected,
    })
    expect(res.status).toBe(201)
  }
  return { ...app, open, variants, card, countV40 }
}

describe('khách thấy đang nhận đặt trước', () => {
  it('biến thể hết hàng thuộc đợt đang mở còn suất là đặt trước, kèm mức cọc và thời gian giao; còn hàng sẵn thì vẫn là còn hàng', async () => {
    const app = await preorderShop()
    const campaignId = await app.open()

    const { 'AM-40': v40, 'AM-41': v41 } = await app.variants()

    expect(v40).toMatchObject({ inStock: true, availability: 'in_stock', preorder: null })
    expect(v41).toEqual(
      expect.objectContaining({
        inStock: false,
        availability: 'preorder',
        preorder: { campaignId, depositPercent: 30, deliveryFrom: '2026-12-10', deliveryTo: '2026-12-20' },
      }),
    )
    // Không lộ số suất hay số đã đặt.
    expect(JSON.stringify(v41)).not.toMatch(/allocation|used/)
  })

  it('không có đợt nào thì biến thể hết hàng vẫn là hết hàng', async () => {
    const app = await preorderShop()

    expect((await app.variants())['AM-41']).toMatchObject({ availability: 'out_of_stock', preorder: null })
  })

  it('biến thể không nằm trong đợt thì không đặt trước được', async () => {
    const app = await preorderShop()
    await app.open([{ variantId: app.v40.id, allocation: 10 }])

    expect((await app.variants())['AM-41']).toMatchObject({ availability: 'out_of_stock' })
  })

  it('hết suất thì hết hàng: đơn chưa hủy chiếm suất, đơn hủy thì trả suất', async () => {
    const app = await preorderShop()
    const campaignId = await app.open([{ variantId: app.v40.id, allocation: 1 }])
    // Một đơn 1 đôi AM-40 thuộc đợt: ticket 04 mới có đường đặt trước qua HTTP, nên gắn đợt cho đơn đặt mua bằng prisma.
    const order = await app.checkout()
    expect(order.status).toBe(201)
    await app.prisma.order.update({ where: { code: order.body.code }, data: { preorderCampaignId: campaignId } })
    // Còn 1 đôi trên kệ, đang giữ đúng 1 cho đơn đó: hết hàng sẵn.
    await app.countV40(1)

    expect((await app.variants())['AM-40']).toMatchObject({ inStock: false, availability: 'out_of_stock' })

    const cancel = await app.request.post(`/api/admin/orders/${order.body.code}/cancel`).set(bearer(app.token))
    expect(cancel.status).toBe(200)
    // Hủy đơn nhả cả hàng đang giữ: AM-40 lại còn hàng sẵn; về 0 thì đặt trước được vì suất đã trống.
    expect((await app.variants())['AM-40']).toMatchObject({ availability: 'in_stock' })
    await app.countV40(0, 1)
    expect((await app.variants())['AM-40']).toMatchObject({ availability: 'preorder' })
  })

  it('đợt đóng tay hay quá hạn đóng thì hết hàng', async () => {
    const app = await preorderShop()
    const first = await app.open()
    expect((await app.request.post(`/api/admin/preorder-campaigns/${first}/close`).set(bearer(app.token))).status).toBe(
      200,
    )
    expect((await app.variants())['AM-41']).toMatchObject({ availability: 'out_of_stock' })

    const second = await app.open()
    expect((await app.variants())['AM-41']).toMatchObject({ availability: 'preorder' })
    // Dựng một đợt đã quá hạn đóng: API không cho đặt hạn ở quá khứ.
    await app.prisma.preorderCampaign.update({ where: { id: second }, data: { closesAt: new Date(Date.now() - 1000) } })
    expect((await app.variants())['AM-41']).toMatchObject({ availability: 'out_of_stock' })
  })

  it('biến thể ngừng bán thì không còn đặt trước được', async () => {
    const app = await preorderShop()
    await app.open()
    expect((await app.editVariant(app.v41, 'AM-41', '41', { status: 'discontinued' })).status).toBe(200)

    // Phiên bản đang xuất bản có thể vẫn liệt kê biến thể này; dù vậy nó không bao giờ là đặt trước.
    expect((await app.variants())['AM-41']?.availability ?? 'absent').not.toBe('preorder')
  })

  it('sản phẩm lưu trữ thì không còn trang, không còn thẻ', async () => {
    const app = await preorderShop()
    await app.open()
    const archive = await app.request
      .put(`/api/admin/products/${app.product.id}/status`)
      .set(bearer(app.token))
      .send({ status: 'archived' })
    expect(archive.status).toBe(200)

    expect((await app.request.get('/api/products/air-max')).status).toBe(404)
    expect(await app.card()).toBeUndefined()
  })
})

describe('thẻ sản phẩm', () => {
  it('còn hàng sẵn thì không có nhãn đặt trước; hết hàng sẵn mà có biến thể đặt trước thì có; không có đợt thì không', async () => {
    const app = await preorderShop()

    expect(await app.card()).toMatchObject({ inStock: true, preorder: false })
    await app.countV40(0)
    expect(await app.card()).toMatchObject({ inStock: false, preorder: false })
    await app.open()
    expect(await app.card()).toMatchObject({ inStock: false, preorder: true })
  })

  it('sắp xếp còn hàng trước không coi hàng đặt trước là còn hàng', async () => {
    const app = await preorderShop()
    const { request, token, brand, category } = app
    // Sản phẩm thứ hai, còn hàng, xuất bản sau Air Max nên mặc định đứng trước; cho Air Max xuất bản lại sau cùng.
    const other = await request
      .post('/api/admin/products')
      .set(bearer(token))
      .send({
        brandId: brand.id,
        categoryId: category.id,
        name: 'Pegasus',
        slug: 'pegasus',
        attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
      })
    expect(other.status).toBe(201)
    const variant = await request
      .post(`/api/admin/products/${other.body.id}/variants`)
      .set(bearer(token))
      .send({ sku: 'PG-40', attributes: { mau: 'Đen', size: '40' }, price: 1_500_000 })
    expect(variant.status).toBe(201)
    const photo = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#333' } })
      .jpeg()
      .toBuffer()
    const image = await request
      .post(`/api/admin/products/${other.body.id}/images`)
      .set(bearer(token))
      .attach('file', photo, 'anh.jpg')
    expect(image.status).toBe(201)
    expect(
      (
        await request
          .put(`/api/admin/products/${other.body.id}/status`)
          .set(bearer(token))
          .send({ status: 'published' })
      ).status,
    ).toBe(200)
    const opening = await adjust(request, token, {
      variantId: variant.body.id,
      reason: 'stocktake',
      countedQuantity: 2,
      expectedOnHand: 0,
    })
    expect(opening.status).toBe(201)
    await app.countV40(0)
    await app.open()
    const slugs = async () =>
      ((await request.get('/api/products').query({ sort: 'price_desc' })).body.items as { slug: string }[]).map(
        (c) => c.slug,
      )

    // Air Max đắt hơn nhưng chỉ đặt trước được: vẫn xếp sau Pegasus còn hàng.
    expect(await slugs()).toEqual(['pegasus', 'air-max'])
  })
})
