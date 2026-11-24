import {
  CheckoutRequest,
  ErrorCode,
  RESERVATION_MINUTES,
  provinceName,
  type CheckoutConflictDetails,
  PreorderRequest,
  type CheckoutResult,
  type PreorderChange,
  type PreorderConflictDetails,
  type VoucherConflict,
} from '@ecommerce/shared'
import { wardName } from '@ecommerce/shared/wards'
import type { Logger } from 'pino'
import type { z } from 'zod'
import type { AppDeps } from '../app.ts'
import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import { cartVariants, type CartVariant } from '../checkout/live-variants.ts'
import { createOrderPaymentLink, livePolicyVersions, storedImageOf } from '../checkout/order-snapshot.ts'
import { enforcePendingOrderLimit } from '../checkout/pending-orders.ts'
import { findCurrentPreorderPolicy, findCurrentPrivacyPolicy } from '../content/pages.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import type { PaymentPurpose } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { checkPreorder } from '../preorders/check.ts'
import { requireShippingFeeConfig } from '../shipping/shipping-fees.ts'
import { reserveStock } from '../stock/stock.ts'
import { applyVoucherToOrder, voucherSnapshot, type VoucherLine } from '../vouchers/apply.ts'
import { recordOrderEvent } from './orders.ts'
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

type Tx = Prisma.TransactionClient

/** Dòng đơn trước khi chia tiền giảm. */
type LineDraft = Omit<Prisma.OrderLineUncheckedCreateWithoutOrderInput, 'discount'>

/** Phần của một loại đơn mà pipeline cần sau khi plan đã khóa và kiểm. */
type Claim = {
  lines: LineDraft[]
  /** Các dòng như mã giảm giá thấy (thương hiệu, danh mục lấy từ snapshot). */
  voucherLines: VoucherLine[]
  subtotal: number
  /** Biến thể để chụp phiên bản chính sách của sản phẩm. */
  variants: Iterable<CartVariant>
  /** Mức cọc của đợt; không có với đơn hàng sẵn. */
  depositPercent?: number
  /** `details` của 409 khi mã giảm giá không còn như khách đã thấy. */
  voucherConflictDetails: (voucher: VoucherConflict) => Record<string, unknown>
  /** Phần riêng của loại đơn, tính khi đã có số tiền. */
  settle: (amounts: { total: number; depositAmount: number | null }) => {
    /** Cột riêng của loại đơn trên `order`. */
    orderColumns: Partial<Prisma.OrderUncheckedCreateInput>
    /** Phiên bản chính sách riêng của loại đơn, thêm vào chính sách của sản phẩm. */
    extraPolicyVersionIds: string[]
    eventData: Prisma.InputJsonObject
    payment: { purpose: PaymentPurpose; amount: number; description: (code: number) => string }
  }
}

/** Phần riêng của một loại đơn. Nội bộ module: nơi gọi chọn loại đơn bằng entry point. */
type Plan<Input> = {
  /** Động từ trong thông điệp lỗi: "đặt mua", "đặt trước". */
  verb: string
  saleType: 'standard' | 'preorder'
  /** Thông điệp 429 khi quá giới hạn đặt theo IP. */
  tooManyAttempts: string
  /** Kiểm thêm trước khi đụng DB (bước 1). */
  checkInput?: (input: Input) => void
  /** Bước 4–5: đọc chính sách riêng, khóa dòng biến thể hay dòng suất, kiểm và dựng dòng đơn. Lỗi thì ném 409. */
  claim: (tx: Tx, input: Input) => Promise<Claim>
}

/** Phần chung của body đặt mua và đặt trước, sau khi parse. */
type PlacementInput = Pick<
  z.output<typeof CheckoutRequest>,
  'address' | 'invoice' | 'note' | 'acceptPrivacyPolicy' | 'voucherCode' | 'discount'
>

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

/**
 * Đặt mua: mọi dòng giỏ phải còn bán, đúng giá khách thấy và đủ hàng. Gom mọi dòng sai trong một lần, theo thứ tự dòng
 * khách gửi; vẫn giữ hàng các dòng đúng để báo đủ các dòng thiếu hàng (lỗi thì rollback nên không giữ gì).
 */
const datMua: Plan<z.output<typeof CheckoutRequest>> = {
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
    const reserved = await reserveStock(
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

    // Tới đây mọi dòng đều có biến thể đang bán trong snapshot đang xuất bản, và đã được giữ đủ số lượng.
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

const preorderConflict = (change: PreorderChange) => {
  const messages: Record<PreorderChange['kind'], string> = {
    in_stock: 'Sản phẩm đã có hàng sẵn, bạn có thể mua ngay',
    price: 'Giá đã thay đổi, hãy xem lại trước khi đặt trước',
    deposit: 'Mức cọc đã thay đổi, hãy xem lại trước khi đặt trước',
    campaign: 'Đợt đặt trước đã thay đổi hoặc đã đóng',
    sold_out: 'Không còn đủ suất đặt trước cho số lượng này',
    discontinued: 'Sản phẩm không còn bán',
  }
  const details: PreorderConflictDetails = { change }
  return new AppError(409, ErrorCode.CONFLICT, messages[change.kind], undefined, details)
}

/**
 * Đặt trước một biến thể, không qua giỏ hàng (ADR 0012): mỗi đơn một dòng, trả cọc trước. Đơn chờ cọc chiếm suất của
 * đợt, không giữ hàng (ADR 0013); hết hạn hay hủy thì suất tự trống ra. Dừng ở thay đổi đầu tiên khách cần xem lại.
 */
const datTruoc: Plan<z.output<typeof PreorderRequest>> = {
  verb: 'đặt trước',
  saleType: 'preorder',
  tooManyAttempts: 'Bạn đã đặt quá nhiều lần, vui lòng thử lại sau',
  checkInput(input) {
    if (input.acceptPreorderPolicy !== true) {
      throw invalidField('acceptPreorderPolicy', 'Cần đồng ý với chính sách đặt trước')
    }
  },
  async claim(tx, input) {
    const preorderPolicy = await findCurrentPreorderPolicy(tx)
    if (!preorderPolicy) {
      throw new AppError(
        503,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Chưa thể đặt trước vì chính sách đặt trước chưa được công bố',
      )
    }

    const { found, campaign, problem } = await checkPreorder(tx, input.variantId, input.quantity, { lock: true })
    const variant = found.variant
    if (problem === 'discontinued' || !variant) throw preorderConflict({ kind: 'discontinued' })
    if (problem === 'in_stock') throw preorderConflict({ kind: 'in_stock' })
    // Đợt khách thấy đã đóng hay đã thay bằng đợt khác: lời hẹn giao có thể khác, khách phải xem lại.
    if (!campaign || campaign.id !== input.campaignId) throw preorderConflict({ kind: 'campaign' })
    if (variant.price !== input.price) {
      throw preorderConflict({ kind: 'price', from: input.price, to: variant.price })
    }
    if (campaign.depositPercent !== input.depositPercent) {
      throw preorderConflict({ kind: 'deposit', from: input.depositPercent, to: campaign.depositPercent })
    }
    if (problem === 'sold_out') throw preorderConflict({ kind: 'sold_out' })

    const snapshot = found.snapshot!
    return {
      // Đơn một dòng nên dòng nhận cả phần giảm; không giữ hàng.
      lines: [
        {
          position: 0,
          variantId: variant.id,
          sku: variant.sku,
          productName: snapshot.name,
          attributes: variant.attributes,
          image: storedImageOf(found) ?? undefined,
          price: variant.price,
          quantity: input.quantity,
        },
      ],
      voucherLines: [
        {
          variantId: variant.id,
          brandId: snapshot.brandId,
          categoryId: snapshot.categoryId,
          price: variant.price,
          quantity: input.quantity,
        },
      ],
      subtotal: variant.price * input.quantity,
      variants: [found],
      depositPercent: campaign.depositPercent,
      voucherConflictDetails: (voucher): PreorderConflictDetails => ({ voucher }),
      settle: ({ depositAmount }) => ({
        orderColumns: {
          kind: 'preorder',
          preorderCampaignId: campaign.id,
          depositPercent: campaign.depositPercent,
          depositAmount: depositAmount!,
          deliveryFrom: campaign.deliveryFrom,
          deliveryTo: campaign.deliveryTo,
          remainderDays: campaign.remainderDays,
        },
        extraPolicyVersionIds: [preorderPolicy.id],
        eventData: { depositAmount: depositAmount!, campaignId: campaign.id },
        payment: {
          purpose: 'deposit',
          amount: depositAmount!,
          description: (code) => `Đặt cọc đơn hàng #${code}`,
        },
      }),
    }
  },
}
