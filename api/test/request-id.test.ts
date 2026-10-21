import { describe, expect, it } from 'vitest'
import { createTestApp } from './support/test-app.ts'

describe('request id', () => {
  it('có trong response header và trong log JSON của request', async () => {
    const { request, logs } = await createTestApp()

    const res = await request.get('/healthz')

    const requestId = res.headers['x-request-id']
    expect(requestId).toEqual(expect.any(String))
    expect(logs().some((line) => line.reqId === requestId)).toBe(true)
  })

  it('dùng lại request id do client hoặc proxy gửi lên', async () => {
    const { request } = await createTestApp()

    const res = await request.get('/healthz').set('X-Request-Id', 'tu-caddy-123')

    expect(res.headers['x-request-id']).toBe('tu-caddy-123')
  })

  it('có trong body lỗi để đối chiếu với log', async () => {
    const { request } = await createTestApp()

    const res = await request.get('/api/khong-co')

    expect(res.body.error.requestId).toBe(res.headers['x-request-id'])
  })
})
