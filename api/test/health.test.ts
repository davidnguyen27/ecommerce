import { describe, expect, it } from 'vitest'
import { createTestApp } from './support/test-app.ts'

describe('GET /healthz', () => {
  it('trả 200 khi kết nối được DB', async () => {
    const { request } = await createTestApp()

    const res = await request.get('/healthz')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok', db: 'ok' })
  })

  it('trả 503 với mã lỗi thống nhất khi mất kết nối DB', async () => {
    const { request } = await createTestApp({
      databaseUrl: 'postgresql://nobody:nothing@127.0.0.1:1/missing',
    })

    const res = await request.get('/healthz')

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE')
  })
})
