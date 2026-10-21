import { describe, expect, it } from 'vitest'
import { createTestApp } from './support/test-app.ts'

// Đăng nhập là endpoint thật nhận dữ liệu vào, đi qua đúng đường kiểm tra dữ liệu chung.
const LOGIN = '/api/admin/auth/login'

describe('cấu trúc lỗi thống nhất', () => {
  it('request sai schema trả 400 kèm lỗi theo từng trường', async () => {
    const { request } = await createTestApp()

    const res = await request.post(LOGIN).set('X-Client', 'web').send({ email: 'khong-phai-email' })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.fields.map((f: { path: string }) => f.path).sort()).toEqual(['email', 'password'])
    for (const field of res.body.error.fields) {
      expect(field.message).toEqual(expect.any(String))
    }
  })

  it('JSON hỏng trả 400 VALIDATION_ERROR', async () => {
    const { request } = await createTestApp()

    const res = await request
      .post(LOGIN)
      .set('X-Client', 'web')
      .set('Content-Type', 'application/json')
      .send('{"email":')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('body quá lớn trả 413 với cấu trúc lỗi thống nhất', async () => {
    const { request } = await createTestApp()

    const res = await request
      .post(LOGIN)
      .set('X-Client', 'web')
      .send({ email: 'x'.repeat(2 * 1024 * 1024) })

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
