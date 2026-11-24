import { createHmac } from 'node:crypto'
import { VNPAY_HASH_SECRET } from './test-app.ts'

/** `vnp_TxnRef` as checkout sends VNPAY for an order created at 2026-11-02 10:15:00 Vietnam time. */
export const txnRefOf = (orderCode: number) => `${orderCode}T20261102101500`

/** A fake VNPAY transaction number for an order. */
export const transactionNoOf = (orderCode: number) => String(14000000 + orderCode)

/** IPN params VNPAY sends on a successful payment, every field the docs list; `params` overrides fields. */
export function ipnParams(orderCode: number, amount: number, params: Record<string, string> = {}) {
  return {
    vnp_TmnCode: 'TESTTMN1',
    vnp_Amount: String(amount * 100),
    vnp_BankCode: 'NCB',
    vnp_BankTranNo: 'VNP' + transactionNoOf(orderCode),
    vnp_CardType: 'ATM',
    // 2026-11-02 10:15:30 Vietnam time.
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
 * The IPN query as VNPAY sends it: adds `vnp_SecureHash` = HMAC-SHA512 (hex) over params sorted by name, encoded like
 * PHP's `urlencode` (spaces as `+`), joined with `&`. Written here so we never sign with the code under test.
 */
export function signedIpn(params: Record<string, string>, secret = VNPAY_HASH_SECRET) {
  const data = Object.keys(params)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(params[key]!).replace(/%20/g, '+')}`)
    .join('&')
  return { ...params, vnp_SecureHash: createHmac('sha512', secret).update(data).digest('hex') }
}
