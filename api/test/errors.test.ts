import { Router } from 'express'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parse } from '../src/http/validation.ts'
import { createTestApp } from './support/test-app.ts'

// Chưa có endpoint thật nào nhận dữ liệu vào, nên dùng một endpoint thử
// đi qua đúng đường kiểm tra dữ liệu mà các route thật sẽ dùng.
const OrderDraft = z.object({
  email: z.email(),
  items: z.array(z.object({ sku: z.string().min(1), qty: z.int().positive() })).min(1),
})
const probe = Router().post('/probe', (req, res) => {
  res.status(201).json(parse(OrderDraft, req.body))
})

describe('cấu trúc lỗi thống nhất', () => {
  it('request sai schema trả 400 kèm lỗi theo từng trường', async () => {
    const { request } = await createTestApp({ extraRoutes: probe })

    const res = await request
      .post('/api/probe')
      .send({ email: 'khong-phai-email', items: [{ sku: 'A1', qty: 0 }] })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.fields.map((f: { path: string }) => f.path).sort()).toEqual([
      'email',
      'items.0.qty',
    ])
    for (const field of res.body.error.fields) {
      expect(field.message).toEqual(expect.any(String))
    }
  })

  it('request đúng schema đi qua bình thường', async () => {
    const { request } = await createTestApp({ extraRoutes: probe })

    const res = await request
      .post('/api/probe')
      .send({ email: 'khach@example.com', items: [{ sku: 'A1', qty: 2 }] })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ email: 'khach@example.com', items: [{ sku: 'A1', qty: 2 }] })
  })

  it('JSON hỏng trả 400 VALIDATION_ERROR', async () => {
    const { request } = await createTestApp({ extraRoutes: probe })

    const res = await request
      .post('/api/probe')
      .set('Content-Type', 'application/json')
      .send('{"email":')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('body quá lớn trả 413 với cấu trúc lỗi thống nhất', async () => {
    const { request } = await createTestApp({ extraRoutes: probe })

    const res = await request.post('/api/probe').send({ email: 'x'.repeat(2 * 1024 * 1024) })

    expect(res.status).toBe(413)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('route không tồn tại trả 404 NOT_FOUND', async () => {
    const { request } = await createTestApp()

    const res = await request.get('/api/khong-co')

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})
