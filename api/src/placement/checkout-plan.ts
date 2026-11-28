import { ErrorCode, type CheckoutConflictDetails, type CheckoutRequest } from '@ecommerce/shared'
import type { z } from 'zod'
import { cartVariants } from '../modules/product/index.ts'
import { storedImageOf } from './order-snapshot.ts'
import { AppError } from '../core/errors.ts'
import { stockLedger } from '../modules/stock/index.ts'
import type { Plan } from './placement-plan.ts'

/**
 * Checkout: every line must be on sale, at the price seen, and in stock. Reports all bad lines at once, in input order;
 * still reserves the valid lines so every short line is found (the 409 rolls the reservation back).
 */
export const checkoutPlan: Plan<z.output<typeof CheckoutRequest>> = {
  verb: 'đặt mua',
  saleType: 'standard',
  tooManyAttempts: 'Bạn đã đặt mua quá nhiều lần, vui lòng thử lại sau',
  async claim(tx, input) {
    const variants = await cartVariants(
      tx,
      input.lines.map((l) => l.variantId),
    )
    const problems: CheckoutConflictDetails['lines'] = []
    for (const line of input.lines) {
      const variant = variants.get(line.variantId)?.variant
      if (!variant) problems.push({ variantId: line.variantId, change: { kind: 'discontinued' } })
      else if (variant.price !== line.price) {
        problems.push({ variantId: line.variantId, change: { kind: 'price', from: line.price, to: variant.price } })
      }
    }
    const reserved = await stockLedger.reserve(
      tx,
      input.lines.filter((line) => !problems.some((p) => p.variantId === line.variantId)),
    )
    if (!reserved.ok) {
      for (const variantId of reserved.shortVariantIds) problems.push({ variantId, change: { kind: 'out_of_stock' } })
    }
    if (problems.length > 0) {
      const order = new Map(input.lines.map((line, index) => [line.variantId, index]))
      const details: CheckoutConflictDetails = {
        lines: problems.sort((a, b) => order.get(a.variantId)! - order.get(b.variantId)!),
      }
      throw new AppError(
        409,
        ErrorCode.CONFLICT,
        'Giỏ hàng đã thay đổi, hãy xem lại trước khi đặt mua',
        undefined,
        details,
      )
    }

    // Every line now has a live variant in the published snapshot and is fully reserved.
    const lines = input.lines.map((line, position) => {
      const found = variants.get(line.variantId)!
      const variant = found.variant!
      return {
        position,
        variantId: variant.id,
        sku: variant.sku,
        productName: found.snapshot!.name,
        attributes: variant.attributes,
        image: storedImageOf(found) ?? undefined,
        price: variant.price,
        quantity: line.quantity,
        reservedQuantity: line.quantity,
        brandId: found.snapshot!.brandId,
        categoryId: found.snapshot!.categoryId,
      }
    })
    return {
      lines: lines.map(({ brandId: _b, categoryId: _c, ...line }) => line),
      voucherLines: lines.map(({ variantId, brandId, categoryId, price, quantity }) => ({
        variantId,
        brandId,
        categoryId,
        price,
        quantity,
      })),
      subtotal: lines.reduce((sum, line) => sum + line.price * line.quantity, 0),
      variants: [...variants.values()],
      voucherConflictDetails: (voucher): CheckoutConflictDetails => ({ lines: [], voucher }),
      settle: ({ total }) => ({
        orderColumns: {},
        extraPolicyVersionIds: [],
        eventData: {},
        payment: { purpose: 'full', amount: total, description: (code) => `Thanh toán đơn hàng #${code}` },
      }),
    }
  },
}
