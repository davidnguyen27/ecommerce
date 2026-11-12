import { createHmac } from 'node:crypto'
import { VNPAY_HASH_SECRET } from './test-app.ts'

/** `vnp_TxnRef` như đặt mua gửi VNPAY cho đơn tạo lúc 2026-11-02 10:15:00 giờ Việt Nam. */
export const txnRefOf = (orderCode: number) => `${orderCode}T20261102101500`

/** Mã giao dịch VNPAY giả cho một đơn. */
export const transactionNoOf = (orderCode: number) => String(14000000 + orderCode)

/** Tham số IPN VNPAY gửi khi khách trả thành công, đủ các trường tài liệu liệt kê; `params` ghi đè từng trường. */
export function ipnParams(orderCode: number, amount: number, params: Record<string, string> = {}) {
  return {
    vnp_TmnCode: 'TESTTMN1',
    vnp_Amount: String(amount * 100),
    vnp_BankCode: 'NCB',
    vnp_BankTranNo: 'VNP' + transactionNoOf(orderCode),
    vnp_CardType: 'ATM',
    // 2026-11-02 10:15:30 giờ Việt Nam.
    vnp_PayDate: '20261102101530',
    vnp_OrderInfo: `Thanh toan don hang ${orderCode}`,
    vnp_TransactionNo: transactionNoOf(orderCode),
    vnp_ResponseCode: '00',
    vnp_TransactionStatus: '00',
    vnp_TxnRef: txnRefOf(orderCode),
    ...params,
  }
}

/**
 * Query IPN như VNPAY gửi: thêm `vnp_SecureHash` = HMAC-SHA512 (hex) trên các tham số sắp theo tên, encode kiểu
 * `urlencode` của PHP (khoảng trắng thành `+`), nối bằng `&`. Viết riêng ở đây để không ký bằng chính code đang test.
 */
export function signedIpn(params: Record<string, string>, secret = VNPAY_HASH_SECRET) {
  const data = Object.keys(params)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(params[key]!).replace(/%20/g, '+')}`)
    .join('&')
  return { ...params, vnp_SecureHash: createHmac('sha512', secret).update(data).digest('hex') }
}
