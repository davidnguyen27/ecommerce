import { createHmac } from 'node:crypto'
import { ZALOPAY_KEY2 } from './test-app.ts'

/** `app_trans_id` như đặt mua gửi ZaloPay cho đơn tạo ngày 2026-11-02 giờ Việt Nam. */
export const transId = (orderCode: number) => `261102_${orderCode}_a1b2c3d4`

/** `data` của callback ZaloPay cho một khoản tiền về, đủ các trường tài liệu liệt kê; `data` ghi đè từng trường. */
export function callbackData(orderCode: number, amount: number, data: Record<string, unknown> = {}) {
  return {
    app_id: 9999,
    app_trans_id: transId(orderCode),
    app_time: 1793589000000,
    app_user: String(orderCode),
    amount,
    embed_data: JSON.stringify({ redirecturl: `https://shop.test/don-hang/${orderCode}?ket-qua=1` }),
    item: '[]',
    zp_trans_id: 251102000000000 + orderCode,
    // 2026-11-02 10:15:30 giờ Việt Nam.
    server_time: 1793589330000,
    channel: 38,
    merchant_user_id: 'merchant-user',
    user_fee_amount: 0,
    discount_amount: 0,
    ...data,
  }
}

/**
 * Body callback như ZaloPay gửi: `data` là chuỗi JSON, `mac` là HMAC-SHA256 (hex) bằng key2 trên đúng chuỗi đó.
 * Viết riêng ở đây để không ký bằng chính code đang test.
 */
export function signedCallback(data: Record<string, unknown>, key = ZALOPAY_KEY2) {
  const text = JSON.stringify(data)
  return { data: text, mac: createHmac('sha256', key).update(text).digest('hex'), type: 1 }
}
