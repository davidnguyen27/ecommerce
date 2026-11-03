import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SimulatorPaymentGateway } from '../src/payments/gateway.ts'
import { paymentGatewayFromEnv } from '../src/payments/gateway-from-env.ts'
import { PayosPaymentGateway } from '../src/payments/payos.ts'

// Chọn cổng chạy lúc khởi động, không có đường HTTP nào chạm tới: gọi thẳng hàm, và chạy thật server cho ca production.

const SITE = 'https://shop.test'
const KEYS = { PAYOS_CLIENT_ID: 'client', PAYOS_API_KEY: 'api', PAYOS_CHECKSUM_KEY: 'checksum' }

describe('chọn cổng thanh toán theo biến môi trường', () => {
  it('đủ ba khóa PayOS thì dùng PayOS, kể cả ở production', () => {
    expect(paymentGatewayFromEnv(KEYS, SITE)).toBeInstanceOf(PayosPaymentGateway)
    expect(paymentGatewayFromEnv({ ...KEYS, NODE_ENV: 'production' }, SITE)).toBeInstanceOf(PayosPaymentGateway)
  })

  it('không có khóa nào ngoài production thì dùng cổng giả lập; khóa để trống coi như không có', () => {
    expect(paymentGatewayFromEnv({}, SITE)).toBeInstanceOf(SimulatorPaymentGateway)
    expect(
      paymentGatewayFromEnv({ PAYOS_CLIENT_ID: '', PAYOS_API_KEY: ' ', PAYOS_CHECKSUM_KEY: '' }, SITE),
    ).toBeInstanceOf(SimulatorPaymentGateway)
  })

  it('có khóa nhưng thiếu khóa khác thì báo thiếu khóa nào, ở mọi môi trường', () => {
    expect(() => paymentGatewayFromEnv({ PAYOS_CLIENT_ID: 'client' }, SITE)).toThrow(
      'Cấu hình PayOS thiếu PAYOS_API_KEY, PAYOS_CHECKSUM_KEY',
    )
  })

  it('production thiếu khóa thì không chạy cổng giả lập', () => {
    expect(() => paymentGatewayFromEnv({ NODE_ENV: 'production' }, SITE)).toThrow(
      'NODE_ENV=production cần PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY',
    )
  })

  it('production thiếu khóa chỉ dùng cổng giả lập khi bật rõ PAYMENT_SIMULATOR=allow (smoke, chạy image local)', () => {
    expect(paymentGatewayFromEnv({ NODE_ENV: 'production', PAYMENT_SIMULATOR: 'allow' }, SITE)).toBeInstanceOf(
      SimulatorPaymentGateway,
    )
    expect(() => paymentGatewayFromEnv({ NODE_ENV: 'production', PAYMENT_SIMULATOR: 'yes' }, SITE)).toThrow(
      'NODE_ENV=production cần',
    )
  })

  it('API ở production thiếu khóa PayOS thì dừng khởi động với thông báo rõ', () => {
    const tsx = createRequire(import.meta.url).resolve('tsx/cli')
    const server = fileURLToPath(new URL('../src/server.ts', import.meta.url))
    const result = spawnSync(process.execPath, [tsx, server], {
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^PAYOS_|^PAYMENT_/.test(name))),
        NODE_ENV: 'production',
        // DB không tồn tại: API phải dừng trước khi kết nối.
        DATABASE_URL: 'postgresql://nobody:nobody@127.0.0.1:1/none',
        JWT_SECRET: 'x'.repeat(32),
        SITE_URL: SITE,
        MAIL_PROVIDER: 'log',
        STORAGE_PROVIDER: 'memory',
      },
      encoding: 'utf8',
      timeout: 20_000,
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('NODE_ENV=production cần PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY')
  })
})
