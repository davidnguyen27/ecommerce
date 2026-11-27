import { describe, expect, it } from 'vitest'
import { FulfillmentStatus, canCancelPaid, isDelivered } from '@ecommerce/shared'

// Pure functions shared by the API and the admin/customer pages: the web side has no HTTP path to test, so these tests
// pin the one rule both use.

describe('hủy đơn đã nhận tiền (canCancelPaid)', () => {
  const paid = { status: 'processing', paymentStatus: 'paid' } as const

  it.each(FulfillmentStatus.options)('đơn đang xử lý đã trả đủ, giao hàng %s', (fulfillmentStatus) => {
    const allowed = ['not_prepared', 'preparing', 'returned'].includes(fulfillmentStatus)
    expect(canCancelPaid({ ...paid, fulfillmentStatus })).toBe(allowed)
  })

  it('đơn đặt trước đã cọc hủy được như đơn đã trả đủ', () => {
    expect(
      canCancelPaid({ status: 'processing', paymentStatus: 'deposit_paid', fulfillmentStatus: 'not_prepared' }),
    ).toBe(true)
  })

  it('đơn chưa thanh toán không hủy được theo cách này', () => {
    expect(
      canCancelPaid({ status: 'pending_payment', paymentStatus: 'unpaid', fulfillmentStatus: 'not_prepared' }),
    ).toBe(false)
  })

  it('đơn đã hủy mà vẫn ở nhận hàng hoàn về thì không hủy lại được', () => {
    expect(canCancelPaid({ status: 'cancelled', paymentStatus: 'paid', fulfillmentStatus: 'returned' })).toBe(false)
  })
})

describe('đã giao xong (isDelivered)', () => {
  it('chỉ đơn hoàn tất đã giao mới tính là giao xong', () => {
    expect(isDelivered({ status: 'completed', fulfillmentStatus: 'delivered' })).toBe(true)
    expect(isDelivered({ status: 'processing', fulfillmentStatus: 'handed_over' })).toBe(false)
    expect(isDelivered({ status: 'cancelled', fulfillmentStatus: 'delivered' })).toBe(false)
  })
})
