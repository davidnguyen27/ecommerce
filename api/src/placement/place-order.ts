import {
  ErrorCode,
  RESERVATION_MINUTES,
  provinceName,
  type CheckoutRequest,
  type CheckoutResult,
  type PreorderRequest,
} from '@ecommerce/shared'
import { wardName } from '@ecommerce/shared/wards'
import type { Logger } from 'pino'
import type { z } from 'zod'
import type { AppDeps } from '../app.ts'
import { hashOpaqueToken, newOpaqueToken } from '../core/auth/opaque-token.ts'
import { createOrderPaymentLink } from '../payments/payment-link.ts'
import { livePolicyVersions } from './order-snapshot.ts'
import { enforcePendingOrderLimit } from './pending-orders.ts'
import { findCurrentPrivacyPolicy } from '../content/pages.ts'
import { AppError, invalidField } from '../core/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../core/middleware/rate-limit.ts'
import { requireShippingFeeConfig } from '../shipping/shipping-fees.ts'
import { applyVoucherToOrder, voucherSnapshot } from '../vouchers/apply.ts'
import { checkoutPlan } from './checkout-plan.ts'
import { preorderPlan } from './preorder-plan.ts'
import { recordOrderEvent } from '../orders/orders.ts'
import type { Plan, PlacementInput } from './placement-plan.ts'
import { priceOrder } from './price-order.ts'

export type PlacementDeps = Pick<AppDeps, 'prisma' | 'payments' | 'siteUrl' | 'orderExpiry'>

/** Who places the order, and what is needed from the request. No Express types. */
export type Placer = {
  /** `null` for a guest. */
  customerId: string | null
  /** Raw `req.ip`, sent to the payment gateway. */
  clientIp: string | undefined
  /** Logs gateway errors before the 502. */
  log: Logger
}

/**
 * Order placement (GLOSSARY "Đặt mua", "Đặt trước"). Each entry point creates one pending order in a single
 * transaction and returns its payment link; any failure rolls everything back.
 * Errors are `AppError`: 400 bad body field, 429 IP or pending-order limit (with `retryAfter`), 503 policy not
 * published, 409 something the customer saw has changed (`details` shape per order kind), 502 gateway error.
 */
export function orderPlacement(deps: PlacementDeps) {
  return {
    /** Checkout: reserves stock for every line, pays the full total. */
    checkout: (input: z.output<typeof CheckoutRequest>, placer: Placer): Promise<CheckoutResult> =>
      place(deps, placer, checkoutPlan, input),
    /** Pre-order: one line, takes campaign allocation (no reservation, ADR 0013), pays the deposit. */
    preorder: (input: z.output<typeof PreorderRequest>, placer: Placer): Promise<CheckoutResult> =>
      place(deps, placer, preorderPlan, input),
  }
}

/**
 * Shared pipeline. The step order is an invariant; plans cannot change it:
 * 1. Validate the body, then count one IP attempt outside the transaction (a bad body is not counted, a failed order
 *    does not roll back the counter).
 * 2. Lookup token, open the transaction, shipping config.
 * 3. Pending-order limit: advisory locks on email, then phone.
 * 4. Privacy policy version (guests).
 * 5. Plan: lock variant rows (reservation) or allocation rows, validate, build lines.
 * 6. Voucher: locks its row last, checked on valid lines since the discount depends on price and quantity.
 * 7. Shipping fee, total, deposit: all on goods after discount.
 * 8. Write the order with its snapshot.
 * 9. Event, expiry job, last shipping address.
 * 10. Payment link last: a gateway error rolls back the whole order.
 * Lock order (email → phone → variant/allocation → voucher) matches everywhere else to avoid deadlocks.
 */
async function place<Input extends PlacementInput>(
  { prisma, payments, siteUrl, orderExpiry }: PlacementDeps,
  { customerId, clientIp, log }: Placer,
  plan: Plan<Input>,
  input: Input,
): Promise<CheckoutResult> {
  const { address, invoice } = input
  if (!customerId && input.acceptPrivacyPolicy !== true) {
    throw invalidField('acceptPrivacyPolicy', `Cần đồng ý với chính sách bảo mật để ${plan.verb}`)
  }
  plan.checkInput?.(input)
  const ward = wardName(address.provinceCode, address.wardCode)
  if (!ward) throw invalidField('address.wardCode', 'Phường/xã không thuộc tỉnh/thành đã chọn')
  await enforceRateLimits(
    prisma,
    [{ limit: RATE_LIMITS.checkoutPerIp, subject: String(clientIp) }],
    plan.tooManyAttempts,
  )
  const token = newOpaqueToken()

  return prisma.$transaction(
    async (tx): Promise<CheckoutResult> => {
      const config = await requireShippingFeeConfig(tx)
      await enforcePendingOrderLimit(tx, address)
      // Guests consent to the current version, read in this transaction as at sign-up.
      const privacyPolicy = customerId ? null : await findCurrentPrivacyPolicy(tx)
      if (!customerId && !privacyPolicy) {
        throw new AppError(
          503,
          ErrorCode.SERVICE_UNAVAILABLE,
          `Chưa thể ${plan.verb} vì chính sách bảo mật chưa được công bố`,
        )
      }

      const claim = await plan.claim(tx, input)
      const { subtotal, depositPercent } = claim
      const withoutVoucher = priceOrder(config, {
        subtotal,
        discount: 0,
        provinceCode: address.provinceCode,
        depositPercent,
      })
      const applied =
        input.voucherCode === undefined
          ? null
          : await applyVoucherToOrder(tx, input.voucherCode, {
              saleType: plan.saleType,
              lines: claim.voucherLines,
              customer: { email: address.email, phone: address.phone },
              seenDiscount: input.discount,
              withoutVoucher: {
                totalWithoutVoucher: withoutVoucher.total,
                ...(withoutVoucher.depositAmount !== null && {
                  depositAmountWithoutVoucher: withoutVoucher.depositAmount,
                }),
              },
              detailsOf: claim.voucherConflictDetails,
            })
      const discount = applied ? Number(applied.discount) : 0
      const lineDiscounts = new Map(applied?.lines.map((l) => [l.variantId, l.discount]))
      const { shippingFee, total, depositAmount } = priceOrder(config, {
        subtotal,
        discount,
        provinceCode: address.provinceCode,
        depositPercent,
      })
      const settled = claim.settle({ total, depositAmount })
      const policies = await livePolicyVersions(tx, claim.variants)
      const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60_000)

      const order = await tx.order.create({
        data: {
          ...settled.orderColumns,
          customerId,
          privacyPolicyVersionId: privacyPolicy?.id ?? null,
          invoiceCompanyName: invoice?.companyName ?? null,
          invoiceTaxCode: invoice?.taxCode ?? null,
          invoiceAddress: invoice?.address ?? null,
          recipientName: address.recipientName,
          phone: address.phone,
          email: address.email,
          provinceCode: address.provinceCode,
          provinceName: provinceName(address.provinceCode)!,
          wardCode: address.wardCode,
          wardName: ward,
          streetAddress: address.streetAddress,
          note: input.note,
          subtotal,
          shippingFee,
          total,
          ...(applied && voucherSnapshot(applied.voucher, applied.discount)),
          lookupTokenHash: hashOpaqueToken(token),
          // Reservation deadline; for a pre-order, the deposit deadline that holds the allocation.
          reservedUntil,
          lines: {
            create: claim.lines.map((line) => ({ ...line, discount: lineDiscounts.get(line.variantId) ?? 0n })),
          },
          policyVersions: {
            create: [...policies.map(({ id }) => id), ...settled.extraPolicyVersionIds].map((pageVersionId) => ({
              pageVersionId,
            })),
          },
        },
      })
      await recordOrderEvent(
        tx,
        order.id,
        'created',
        { type: 'customer', customerId: customerId ?? undefined },
        { total, ...settled.eventData, ...(applied && { voucherCode: applied.voucher.code, discount }) },
      )
      await orderExpiry.scheduleOrderExpiry(tx, order.id, reservedUntil)
      // Prefills the next checkout; same transaction, so a failed order keeps the old address.
      if (customerId) {
        const { recipientName, phone, email, provinceCode, wardCode, streetAddress } = address
        await tx.customer.update({
          where: { id: customerId },
          data: { lastShippingAddress: { recipientName, phone, email, provinceCode, wardCode, streetAddress } },
        })
      }

      const checkoutUrl = await createOrderPaymentLink(tx, { payments, siteUrl, clientIp, log }, order, {
        purpose: settled.payment.purpose,
        amount: settled.payment.amount,
        description: settled.payment.description(order.code),
        expiresAt: reservedUntil,
      })
      return { code: order.code, token, checkoutUrl, reservedUntil: reservedUntil.toISOString() }
    },
    // The gateway call runs inside the transaction, so allow more than the default 5 s.
    { timeout: 30_000, maxWait: 10_000 },
  )
}
