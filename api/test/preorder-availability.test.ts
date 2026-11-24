import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { preorderShop as baseShop } from './support/preorder.ts'
import { bearer } from './support/staff.ts'
import { adjust } from './support/stock.ts'

type Availability = { sku: string; inStock: boolean; availability: string; preorder: unknown }

/**
 * A shop with Air Max published: AM-40 with 3 pairs, AM-41 out of stock. `open` opens a pre-order campaign (both
 * variants by default), 30% deposit, delivery 10–20/12/2026.
 */
async function preorderShop() {
  const app = await baseShop()
  const { request, token, v40 } = app
  /** Variants as customers see them on the product page, by SKU. */
  const variants = async () => {
    const res = await request.get('/api/products/air-max')
    expect(res.status).toBe(200)
    return Object.fromEntries((res.body.variants as Availability[]).map((v) => [v.sku, v]))
  }
  /** The Air Max card in the product list. */
  const card = async () => {
    const res = await request.get('/api/products')
    expect(res.status).toBe(200)
    return (res.body.items as { slug: string; inStock: boolean; preorder: boolean }[]).find((c) => c.slug === 'air-max')
  }
  /** Sets AM-40 stock to `count` pairs with one stocktake. */
  const countV40 = async (count: number, expected = 3) => {
    const res = await adjust(request, token, {
      variantId: v40.id,
      reason: 'stocktake',
      countedQuantity: count,
      expectedOnHand: expected,
    })
    expect(res.status).toBe(201)
  }
  return { ...app, variants, card, countV40 }
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
    // No allocation or ordered counts leak.
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

  it('hết suất thì hết hàng: đơn chờ cọc chiếm suất, đơn hủy thì trả suất', async () => {
    const app = await preorderShop()
    const campaignId = await app.open([{ variantId: app.v41.id, allocation: 1 }])
    const { code, token } = await app.placed(campaignId)

    expect((await app.variants())['AM-41']).toMatchObject({ inStock: false, availability: 'out_of_stock' })

    expect((await app.request.post(`/api/orders/${code}/cancel`).query({ token })).status).toBe(200)
    expect((await app.variants())['AM-41']).toMatchObject({ availability: 'preorder' })
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
    // Build a campaign past its closing time: the API refuses deadlines in the past.
    await app.prisma.preorderCampaign.update({ where: { id: second }, data: { closesAt: new Date(Date.now() - 1000) } })
    expect((await app.variants())['AM-41']).toMatchObject({ availability: 'out_of_stock' })
  })

  it('biến thể ngừng bán thì không còn đặt trước được', async () => {
    const app = await preorderShop()
    await app.open()
    expect((await app.editVariant(app.v41, 'AM-41', '41', { status: 'discontinued' })).status).toBe(200)

    // The published version may still list this variant; even so it is never pre-order.
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
    // A second product, in stock, published after Air Max so it comes first by default; republish Air Max last.
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

    // Air Max is pricier but only pre-orderable: still sorted after the in-stock Pegasus.
    expect(await slugs()).toEqual(['pegasus', 'air-max'])
  })
})
