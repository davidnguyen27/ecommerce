import { describe, expect, it } from 'vitest'
import { trustProxyFromEnv } from '../src/app.ts'
import { shop } from './support/shop.ts'
import { createTestApp } from './support/test-app.ts'

// The deploy puts the API behind two proxies (Netlify → Render's load balancer) and a CDN (ADR 0011).

describe('API sau CDN', () => {
  it('response API mặc định không cho cache, kể cả route công khai', async () => {
    const { request } = await createTestApp()

    const res = await request.get('/api/brands')

    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('IP khách sau proxy', () => {
  // Customer → Netlify (writes the client IP into X-Forwarded-For) → load balancer (appends Netlify's IP) → API.
  const XFF = '203.0.113.7, 198.51.100.9'

  it('TRUST_PROXY=2: IP khách là địa chỉ đầu tiên trong chuỗi hai tầng proxy', async () => {
    const { checkout, payments } = await shop({ trustProxy: 2 })

    const res = await checkout().set('X-Forwarded-For', XFF)

    expect(res.status).toBe(201)
    expect(payments.created[0]!.clientIp).toBe('203.0.113.7')
  })

  it('mặc định (Caddy trên VPS) không tin X-Forwarded-For từ địa chỉ công khai', async () => {
    const { checkout, payments } = await shop()

    await checkout().set('X-Forwarded-For', XFF)

    // The test connection comes from loopback (trusted); the next proxy is a public address (untrusted): stop there.
    expect(payments.created[0]!.clientIp).toBe('198.51.100.9')
  })

  it('đọc TRUST_PROXY: số là số tầng, chuỗi giữ nguyên, trống là mặc định', () => {
    expect(trustProxyFromEnv('2')).toBe(2)
    expect(trustProxyFromEnv(' loopback, uniquelocal ')).toBe('loopback, uniquelocal')
    expect(trustProxyFromEnv('')).toBeUndefined()
    expect(trustProxyFromEnv(undefined)).toBeUndefined()
  })
})
