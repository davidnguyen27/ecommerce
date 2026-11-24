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
import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import { createOrderPaymentLink, livePolicyVersions } from '../checkout/order-snapshot.ts'
import { enforcePendingOrderLimit } from '../checkout/pending-orders.ts'
import { findCurrentPrivacyPolicy } from '../content/pages.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { requireShippingFeeConfig } from '../shipping/shipping-fees.ts'
import { applyVoucherToOrder, voucherSnapshot } from '../vouchers/apply.ts'
import { datMua } from './dat-mua.ts'
import { datTruoc } from './dat-truoc.ts'
import { recordOrderEvent } from './orders.ts'
import type { Plan, PlacementInput } from './placement-plan.ts'
import { priceOrder } from './price-order.ts'

export type PlacementDeps = Pick<AppDeps, 'prisma' | 'payments' | 'siteUrl' | 'orderExpiry'>

/** Người đặt và những gì cần từ request; không có kiểu Express. */
export type Placer = {
  /** `null` là khách vãng lai. */
  customerId: string | null
  /** `req.ip` nguyên dạng, gửi cổng thanh toán. */
  clientIp: string | undefined
  /** Log lỗi cổng trước khi ném 502. */
  log: Logger
}

/**
 * Tạo đơn (GLOSSARY "Đặt mua", "Đặt trước"). Mỗi entry point tạo một đơn chờ thanh toán trong một transaction và trả
 * link thanh toán; lỗi ở bất kỳ bước nào thì rollback hết: không đơn, không hàng giữ hay suất chiếm, không lượt dùng
 * mã, không sự kiện, không job hết hạn, không đổi địa chỉ giao gần nhất. Lỗi luôn là `AppError`: 400 trường của body,
 * 429 quá số lần đặt theo IP hay quá số đơn chờ (kèm `retryAfter`), 503 chính sách chưa công bố, 409 thứ khách đã
 * thấy đã đổi (dạng `details` theo loại đơn), 502 cổng thanh toán lỗi.
 */
export function orderPlacement(deps: PlacementDeps) {
  return {
    /** Đặt mua: giữ hàng mọi dòng đơn, trả đủ tổng. */
    checkout: (input: z.output<typeof CheckoutRequest>, placer: Placer): Promise<CheckoutResult> =>
      place(deps, placer, datMua, input),
    /** Đặt trước: một dòng, chiếm suất của đợt (không giữ hàng, ADR 0013), trả tiền cọc. */
    preorder: (input: z.output<typeof PreorderRequest>, placer: Placer): Promise<CheckoutResult> =>
      place(deps, placer, datTruoc, input),
  }
}

/**
 * Pipeline chung. Thứ tự các bước là bất biến của việc tạo đơn, plan không đổi được:
 * 1. Kiểm body trước khi đụng DB: đồng ý chính sách, phường/xã thuộc tỉnh. Rồi đếm một lần đặt theo IP (dùng chung
 *    cho đặt mua và đặt trước), ngoài transaction để đơn hỏng không rollback bộ đếm; body sai thì không bị đếm.
 * 2. Token tra cứu, mở transaction, cấu hình phí giao.
 * 3. Giới hạn đơn chờ: khóa advisory email rồi số điện thoại.
 * 4. Phiên bản chính sách bảo mật (khách vãng lai).
 * 5. Plan: khóa dòng biến thể (giữ hàng) hay dòng suất, kiểm, dựng dòng đơn.
 * 6. Mã giảm giá: khóa dòng mã sau dòng biến thể/suất, kiểm trên các dòng đã đúng vì tiền giảm phụ thuộc giá và số lượng.
 * 7. Phí giao, tổng, tiền cọc: đều tính trên tiền hàng sau giảm.
 * 8. Ghi đơn với snapshot.
 * 9. Sự kiện, job hết hạn, địa chỉ giao gần nhất.
 * 10. Link thanh toán sau cùng, khi mọi thứ khác đã ghi được: cổng lỗi thì cả đơn rollback.
 * Thứ tự khóa (email → số điện thoại → biến thể/suất → mã) giống mọi nơi khác để không deadlock.
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
      // Khách vãng lai đồng ý với phiên bản hiện hành, đọc trong cùng transaction như lúc đăng ký.
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
          // Hạn giữ hàng; đơn đặt trước chờ cọc thì là hạn trả cọc, chiếm suất tới hạn này.
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
      // Trang đặt lần sau tự điền; cùng transaction nên đặt hỏng thì địa chỉ cũ giữ nguyên.
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
    // Gọi cổng thanh toán nằm trong transaction nên cần lâu hơn mặc định 5 giây.
    { timeout: 30_000, maxWait: 10_000 },
  )
}
