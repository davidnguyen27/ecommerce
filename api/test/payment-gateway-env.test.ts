import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SimulatorPaymentGateway } from '../src/payments/gateway.ts'
import { paymentGatewayFromEnv, vnpayKeysFromEnv } from '../src/payments/gateway-from-env.ts'
import { VnpayPaymentGateway } from '../src/payments/vnpay.ts'

// Chọn cổng chạy lúc khởi động, không có đường HTTP nào chạm tới: gọi thẳng hàm, và chạy thật server cho ca production.

const SITE = 'https://shop.test'
const KEYS = { VNPAY_TMN_CODE: 'TESTTMN1', VNPAY_HASH_SECRET: 'secret-test' }

describe('chọn cổng thanh toán theo biến môi trường', () => {
  it('đủ hai khóa VNPAY thì dùng VNPAY, mặc định sandbox; production cần đặt rõ', () => {
    expect(paymentGatewayFromEnv(KEYS, SITE)).toBeInstanceOf(VnpayPaymentGateway)
    expect(vnpayKeysFromEnv(KEYS)).toEqual({ tmnCode: 'TESTTMN1', hashSecret: 'secret-test', env: 'sandbox' })
    expect(vnpayKeysFromEnv({ ...KEYS, VNPAY_ENV: 'production' })?.env).toBe('production')
    expect(paymentGatewayFromEnv({ ...KEYS, VNPAY_ENV: 'production', NODE_ENV: 'production' }, SITE)).toBeInstanceOf(
      VnpayPaymentGateway,
    )
  })

  it('VNPAY_ENV lạ thì báo lỗi thay vì đoán', () => {
    expect(() => paymentGatewayFromEnv({ ...KEYS, VNPAY_ENV: 'live' }, SITE)).toThrow(
      'VNPAY_ENV chỉ nhận sandbox hoặc production',
    )
  })

  it('không có khóa nào ngoài production thì dùng cổng giả lập; khóa để trống coi như không có', () => {
    expect(paymentGatewayFromEnv({}, SITE)).toBeInstanceOf(SimulatorPaymentGateway)
    expect(paymentGatewayFromEnv({ VNPAY_TMN_CODE: '', VNPAY_HASH_SECRET: ' ' }, SITE)).toBeInstanceOf(
      SimulatorPaymentGateway,
    )
  })

  it('có khóa nhưng thiếu khóa khác thì báo thiếu khóa nào, ở mọi môi trường', () => {
    expect(() => paymentGatewayFromEnv({ VNPAY_TMN_CODE: 'TESTTMN1' }, SITE)).toThrow(
      'Cấu hình VNPAY thiếu VNPAY_HASH_SECRET',
    )
  })

  it('production thiếu khóa thì không chạy cổng giả lập', () => {
    expect(() => paymentGatewayFromEnv({ NODE_ENV: 'production' }, SITE)).toThrow(
      'NODE_ENV=production cần VNPAY_TMN_CODE, VNPAY_HASH_SECRET',
    )
  })

  it('production với khóa sandbox thì dừng, trừ khi bật rõ PAYMENT_SIMULATOR=allow (docker compose trên máy)', () => {
    expect(() => paymentGatewayFromEnv({ ...KEYS, NODE_ENV: 'production' }, SITE)).toThrow(
      'NODE_ENV=production đang dùng VNPAY sandbox',
    )
    expect(
      paymentGatewayFromEnv(
        { ...KEYS, VNPAY_ENV: 'sandbox', NODE_ENV: 'production', PAYMENT_SIMULATOR: 'allow' },
        SITE,
      ),
    ).toBeInstanceOf(VnpayPaymentGateway)
  })

  it('production thiếu khóa chỉ dùng cổng giả lập khi bật rõ PAYMENT_SIMULATOR=allow (smoke, chạy image local)', () => {
    expect(paymentGatewayFromEnv({ NODE_ENV: 'production', PAYMENT_SIMULATOR: 'allow' }, SITE)).toBeInstanceOf(
      SimulatorPaymentGateway,
    )
    expect(() => paymentGatewayFromEnv({ NODE_ENV: 'production', PAYMENT_SIMULATOR: 'yes' }, SITE)).toThrow(
      'NODE_ENV=production cần',
    )
  })

  it('API ở production thiếu khóa VNPAY thì dừng khởi động với thông báo rõ', () => {
    const tsx = createRequire(import.meta.url).resolve('tsx/cli')
    const server = fileURLToPath(new URL('../src/server.ts', import.meta.url))
    const result = spawnSync(process.execPath, [tsx, server], {
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^VNPAY_|^PAYMENT_/.test(name))),
        NODE_ENV: 'production',
        // DB không tồn tại: API phải dừng trước khi kết nối.
        DATABASE_URL: 'postgresql://nobody:nobody@127.0.0.1:1/none',
        JWT_SECRET: 'x'.repeat(32),
        SITE_URL: SITE,
        MAIL_PROVIDER: 'log',
        STORAGE_PROVIDER: 'memory',
      },
      encoding: 'utf8',
      // Nạp server.ts qua tsx chậm khi cả bộ test chạy song song.
      timeout: 90_000,
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('NODE_ENV=production cần VNPAY_TMN_CODE, VNPAY_HASH_SECRET')
  }, 120_000)
})
