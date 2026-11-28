import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { InMemoryStorage } from '../src/core/adapters/storage.ts'
import { ADDRESS, shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

type View = {
  code: number
  messages: {
    id: string
    author: string
    attachments: { id: string; url: string; contentType: string; width: number }[]
  }[]
}

const image = (width = 40, height = 30, format: 'jpeg' | 'png' | 'webp' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: '#a33' } })
    .toFormat(format)
    .toBuffer()

/** The file in test storage for a signed URL (`memory://private/<key>?expires=…`). */
const stored = (storage: InMemoryStorage, url: string) =>
  storage.objects.get(`private/${url.slice('memory://private/'.length).split('?')[0]}`)

/**
 * A guest order with one support request; `attach(messageId, file)` uploads an image to a message via the order lookup
 * link, `staffAttach` via the admin page as the sales clerk.
 */
async function withRequest() {
  const app = await shop()
  const { request, token, checkout } = app
  const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
  const placed = await checkout({ address: { ...ADDRESS, email: 'khach@example.com' } })
  const order = placed.body as { code: number; token: string }
  const base = `/api/orders/${order.code}/support-requests`
  const created = await request
    .post(base)
    .query({ token: order.token })
    .send({ kind: 'other', subject: 'Hàng lỗi', message: 'Đây là ảnh' })
  expect(created.status).toBe(201)
  const view = created.body as View
  const firstMessage = view.messages[0]!.id
  const attach = (messageId: string, file: Buffer, filename = 'anh.png', orderToken = order.token) =>
    request
      .post(`${base}/${view.code}/messages/${messageId}/attachments`)
      .query({ token: orderToken })
      .attach('file', file, filename)
  const staffAttach = (messageId: string, file: Buffer) =>
    request
      .post(`/api/admin/support-requests/${view.code}/messages/${messageId}/attachments`)
      .set(bearer(sales.accessToken))
      .attach('file', file, 'anh.png')
  const get = () => request.get(`${base}/${view.code}`).query({ token: order.token })
  return { ...app, sales, order, view, firstMessage, attach, staffAttach, get, base }
}

describe('ảnh đính kèm của khách', () => {
  it('nhận ảnh đúng loại, lưu ở bucket private, trả URL ký có hạn; nhân viên cũng thấy', async () => {
    const { attach, firstMessage, storage, request, view, token } = await withRequest()

    const res = await attach(firstMessage, await image(40, 30, 'jpeg'))

    expect(res.status).toBe(201)
    const [attachment] = (res.body as View).messages[0]!.attachments
    expect(attachment).toMatchObject({
      contentType: 'image/jpeg',
      width: 40,
      url: expect.stringContaining('expires=300'),
    })
    expect(stored(storage as InMemoryStorage, attachment!.url)).toMatchObject({ bucket: 'private' })
    const admin = await request.get(`/api/admin/support-requests/${view.code}`).set(bearer(token))
    expect(admin.body.messages[0].attachments).toHaveLength(1)
  })

  it('bỏ EXIF và thu cạnh dài về 2000px', async () => {
    const { attach, firstMessage, storage } = await withRequest()
    const tagged = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: '#a33' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'Khách' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '21/1 1/1 30/1' } })
      .toBuffer()
    expect((await sharp(tagged).metadata()).exif).toBeDefined()

    const res = await attach(firstMessage, tagged, 'anh.jpg')

    const url = (res.body as View).messages[0]!.attachments[0]!.url
    const meta = await sharp(stored(storage as InMemoryStorage, url)!.body).metadata()
    expect(meta).toMatchObject({ format: 'jpeg', width: 2000, height: 1000 })
    expect(meta.exif).toBeUndefined()
  })

  it('file đuôi ảnh nhưng không phải ảnh thì 400; ảnh gif thì 400; quá 5 MB thì 413; không lưu gì', async () => {
    const { attach, firstMessage, storage } = await withRequest()
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .gif()
      .toBuffer()

    expect((await attach(firstMessage, Buffer.from('<script>alert(1)</script>'), 'anh.png')).status).toBe(400)
    expect((await attach(firstMessage, gif, 'anh.png')).status).toBe(400)
    expect((await attach(firstMessage, Buffer.alloc(5 * 1024 * 1024 + 1), 'anh.png')).status).toBe(413)
    expect([...(storage as InMemoryStorage).objects.keys()].filter((k) => k.startsWith('private/support/'))).toEqual([])
  })

  it('tối đa 5 ảnh mỗi tin; ảnh thứ 6 bị từ chối và file của nó bị xóa', async () => {
    const { attach, firstMessage, storage } = await withRequest()
    const file = await image()
    for (let i = 0; i < 5; i++) expect((await attach(firstMessage, file)).status).toBe(201)

    const sixth = await attach(firstMessage, file)

    expect(sixth.status).toBe(409)
    const keys = [...(storage as InMemoryStorage).objects.keys()].filter((k) => k.startsWith('private/support/'))
    expect(keys).toHaveLength(5)
  })

  it('không gắn được vào tin của nhân viên, tin lạ, hay qua link của đơn khác', async () => {
    const { attach, view, request, sales, checkout, get } = await withRequest()
    const reply = await request
      .post(`/api/admin/support-requests/${view.code}/reply`)
      .set(bearer(sales.accessToken))
      .send({ message: 'Cho xin ảnh' })
    const staffMessage = (reply.body.messages as { id: string }[]).at(-1)!.id
    const other = (await checkout({ address: { ...ADDRESS, email: 'khac@example.com', phone: '0911111111' } }))
      .body as { code: number; token: string }

    expect((await attach(staffMessage, await image())).status).toBe(404)
    expect((await attach('00000000-0000-0000-0000-000000000000', await image())).status).toBe(404)
    expect((await attach((await get()).body.messages[0].id, await image(), 'anh.png', other.token)).status).toBe(404)
  })

  it('tin gửi quá 30 phút thì 409; yêu cầu đã kết thúc thì 409', async () => {
    const { attach, firstMessage, prisma, view, request, sales } = await withRequest()
    await prisma.supportMessage.update({
      where: { id: firstMessage },
      data: { createdAt: new Date(Date.now() - 31 * 60_000) },
    })
    expect((await attach(firstMessage, await image())).status).toBe(409)

    await request
      .post(`/api/admin/support-requests/${view.code}/reply`)
      .set(bearer(sales.accessToken))
      .send({ status: 'resolved' })
    await prisma.supportMessage.update({ where: { id: firstMessage }, data: { createdAt: new Date() } })
    expect((await attach(firstMessage, await image())).status).toBe(409)
  })
})

describe('ảnh đính kèm của nhân viên', () => {
  it('gắn vào tin của chính mình, có audit; không gắn được vào tin của khách; kho bị 403', async () => {
    const { staffAttach, firstMessage, view, request, sales, token } = await withRequest()
    const reply = await request
      .post(`/api/admin/support-requests/${view.code}/reply`)
      .set(bearer(sales.accessToken))
      .send({ message: 'Ảnh hướng dẫn đóng gói' })
    const own = (reply.body.messages as { id: string }[]).at(-1)!.id

    expect((await staffAttach(own, await image())).status).toBe(201)
    expect((await staffAttach(firstMessage, await image())).status).toBe(404)
    const warehouse = await createStaff(request, token, ['warehouse'], 'kho@example.com')
    const denied = await request
      .post(`/api/admin/support-requests/${view.code}/messages/${own}/attachments`)
      .set(bearer(warehouse.accessToken))
      .attach('file', await image(), 'anh.png')
    expect(denied.status).toBe(403)
    const audits = await request.get('/api/admin/audit').set(bearer(token))
    expect((audits.body.items as { action: string }[]).map((a) => a.action)).toContain('support.attach')
  })

  it('ảnh của ghi chú nội bộ không lộ cho khách', async () => {
    const { staffAttach, view, request, sales, get } = await withRequest()
    const note = await request
      .post(`/api/admin/support-requests/${view.code}/reply`)
      .set(bearer(sales.accessToken))
      .send({ message: 'Ảnh nội bộ', internal: true })
    const noteId = (note.body.messages as { id: string }[]).at(-1)!.id
    expect((await staffAttach(noteId, await image())).status).toBe(201)

    const seen = (await get()).body as View
    expect(seen.messages.map((m) => m.id)).not.toContain(noteId)
    expect(JSON.stringify(seen)).not.toContain('memory://private/support/')
  })
})

describe('giới hạn mỗi yêu cầu', () => {
  it('đủ 20 ảnh trong yêu cầu thì ảnh tiếp theo bị từ chối', async () => {
    const { attach, firstMessage, prisma, view } = await withRequest()
    const request = await prisma.supportRequest.findUniqueOrThrow({ where: { code: view.code } })
    // 20 images over 4 messages (5 each at most), built with prisma for speed.
    for (let m = 0; m < 4; m++) {
      const message = await prisma.supportMessage.create({
        data: { requestId: request.id, author: 'customer', body: `Tin ${m}` },
      })
      await prisma.supportAttachment.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          requestId: request.id,
          messageId: message.id,
          key: `support/${request.id}/san-${m}-${i}.png`,
          contentType: 'image/png',
          sizeBytes: 10,
          width: 1,
          height: 1,
        })),
      })
    }

    const res = await attach(firstMessage, await image())

    expect(res.status).toBe(409)
    expect(res.body.error.message).toContain('20 ảnh')
  })
})
