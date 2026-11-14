import { Router } from 'express'
import {
  ErrorCode,
  PreorderQuoteRequest,
  PreorderRequest,
  RESERVATION_MINUTES,
  depositFor,
  provinceName,
  shippingFeeFor,
  type CheckoutResult,
  type PreorderChange,
  type PreorderConflictDetails,
  type PreorderQuote,
} from '@ecommerce/shared'
import { wardName } from '@ecommerce/shared/wards'
import type { AppDeps } from '../app.ts'
import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import { optionalAuth } from '../auth/require-auth.ts'
import { createOrderPaymentLink, livePolicyVersions, storedImageOf } from '../checkout/order-snapshot.ts'
import { enforcePendingOrderLimit } from '../checkout/pending-orders.ts'
import { findCurrentPreorderPolicy, findCurrentPrivacyPolicy } from '../content/pages.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { parse } from '../http/validation.ts'
import { imageRenditions } from '../media/images.ts'
import { recordOrderEvent } from '../orders/orders.ts'
import { checkPreorder } from '../preorders/check.ts'
import { requireShippingFeeConfig } from '../shipping/shipping-fees.ts'

const day = (date: Date) => date.toISOString().slice(0, 10)

const conflict = (change: PreorderChange) => {
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

const policyUnavailable = () =>
  new AppError(503, ErrorCode.SERVICE_UNAVAILABLE, 'Chưa thể đặt trước vì chính sách đặt trước chưa được công bố')

/**
 * Đặt trước một biến thể, không qua giỏ hàng (ADR 0012): mỗi đơn một dòng, trả cọc trước. Đơn chờ cọc chiếm suất của
 * đợt, không giữ hàng (ADR 0013); hết hạn hay hủy thì suất tự trống ra. Không cần đăng nhập; kèm access token khách
 * thì đơn gắn với tài khoản.
 */
export function preorderRoutes({ prisma, storage, payments, siteUrl, jwtSecret, orderExpiry }: AppDeps) {
  const customerSession = optionalAuth(new TextEncoder().encode(jwtSecret), 'customer')
  return Router()
    .post('/quote', async (req, res) => {
      const input = parse(PreorderQuoteRequest, req.body)
      const [config, preorderPolicy, check] = await Promise.all([
        requireShippingFeeConfig(prisma),
        findCurrentPreorderPolicy(prisma),
        checkPreorder(prisma, input.variantId, input.quantity),
      ])
      const { found, campaign, problem } = check
      const { snapshot, variant } = found
      const policies = await livePolicyVersions(prisma, [found])
      const image = variant && storedImageOf(found)
      const subtotal = variant ? variant.price * input.quantity : null
      const shippingFee =
        subtotal === null || input.provinceCode === undefined
          ? null
          : shippingFeeFor(config, input.provinceCode, subtotal)
      const total = subtotal === null || shippingFee === null ? null : subtotal + shippingFee
      const depositAmount = subtotal === null || !campaign ? null : depositFor(subtotal, campaign.depositPercent)

      const body: PreorderQuote = {
        variantId: input.variantId,
        quantity: input.quantity,
        product: variant && snapshot && { slug: snapshot.slug, name: snapshot.name },
        sku: variant?.sku ?? null,
        attributes: variant?.attributes ?? null,
        image: image ? { ...imageRenditions(storage, image), alt: image.alt } : null,
        price: variant?.price ?? null,
        offer: campaign && {
          campaignId: campaign.id,
          depositPercent: campaign.depositPercent,
          deliveryFrom: day(campaign.deliveryFrom),
          deliveryTo: day(campaign.deliveryTo),
          remainderDays: campaign.remainderDays,
        },
        problem: problem && { kind: problem },
        subtotal,
        depositAmount,
        shippingFee,
        total,
        remainingAmount: total === null || depositAmount === null ? null : total - depositAmount,
        preorderPolicy: preorderPolicy && { slug: preorderPolicy.page.slug, title: preorderPolicy.title },
        policies: policies.map(({ slug, title }) => ({ slug, title })),
        groundShippingOnly: Boolean(variant && snapshot?.groundShippingOnly),
      }
      res.json(body)
    })
    .post('/', customerSession, async (req, res) => {
      const input = parse(PreorderRequest, req.body)
      const { address, invoice } = input
      const customerId = req.auth?.subjectId ?? null
      if (!customerId && input.acceptPrivacyPolicy !== true) {
        throw invalidField('acceptPrivacyPolicy', 'Cần đồng ý với chính sách bảo mật để đặt trước')
      }
      if (input.acceptPreorderPolicy !== true) {
        throw invalidField('acceptPreorderPolicy', 'Cần đồng ý với chính sách đặt trước')
      }
      const ward = wardName(address.provinceCode, address.wardCode)
      if (!ward) throw invalidField('address.wardCode', 'Phường/xã không thuộc tỉnh/thành đã chọn')
      // Chung giới hạn với đặt mua: đặt trước cũng tạo đơn chờ thanh toán.
      await enforceRateLimits(
        prisma,
        res,
        [{ limit: RATE_LIMITS.checkoutPerIp, subject: String(req.ip) }],
        'Bạn đã đặt quá nhiều lần, vui lòng thử lại sau',
      )
      const token = newOpaqueToken()

      // Một transaction: thay đổi, hết suất hay cổng lỗi đều rollback, không còn đơn nào chiếm suất.
      const body = await prisma.$transaction(
        async (tx): Promise<CheckoutResult> => {
          const config = await requireShippingFeeConfig(tx)
          await enforcePendingOrderLimit(tx, res, address)
          const privacyPolicy = customerId ? null : await findCurrentPrivacyPolicy(tx)
          if (!customerId && !privacyPolicy) {
            throw new AppError(
              503,
              ErrorCode.SERVICE_UNAVAILABLE,
              'Chưa thể đặt trước vì chính sách bảo mật chưa được công bố',
            )
          }
          const preorderPolicy = await findCurrentPreorderPolicy(tx)
          if (!preorderPolicy) throw policyUnavailable()

          const { found, campaign, problem } = await checkPreorder(tx, input.variantId, input.quantity, { lock: true })
          const variant = found.variant
          if (problem === 'discontinued' || !variant) throw conflict({ kind: 'discontinued' })
          if (problem === 'in_stock') throw conflict({ kind: 'in_stock' })
          // Đợt khách thấy đã đóng hay đã thay bằng đợt khác: lời hẹn giao có thể khác, khách phải xem lại.
          if (!campaign || campaign.id !== input.campaignId) throw conflict({ kind: 'campaign' })
          if (variant.price !== input.price) throw conflict({ kind: 'price', from: input.price, to: variant.price })
          if (campaign.depositPercent !== input.depositPercent) {
            throw conflict({ kind: 'deposit', from: input.depositPercent, to: campaign.depositPercent })
          }
          if (problem === 'sold_out') throw conflict({ kind: 'sold_out' })

          const subtotal = variant.price * input.quantity
          const shippingFee = shippingFeeFor(config, address.provinceCode, subtotal)
          const total = subtotal + shippingFee
          const depositAmount = depositFor(subtotal, campaign.depositPercent)
          const policies = await livePolicyVersions(tx, [found])
          const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60_000)

          const order = await tx.order.create({
            data: {
              kind: 'preorder',
              preorderCampaignId: campaign.id,
              depositPercent: campaign.depositPercent,
              depositAmount,
              deliveryFrom: campaign.deliveryFrom,
              deliveryTo: campaign.deliveryTo,
              remainderDays: campaign.remainderDays,
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
              lookupTokenHash: hashOpaqueToken(token),
              // Hạn trả cọc; đơn chờ cọc chiếm suất tới hạn này, không giữ hàng.
              reservedUntil,
              lines: {
                create: {
                  position: 0,
                  variantId: variant.id,
                  sku: variant.sku,
                  productName: found.snapshot!.name,
                  attributes: variant.attributes,
                  image: storedImageOf(found) ?? undefined,
                  price: variant.price,
                  quantity: input.quantity,
                },
              },
              policyVersions: {
                create: [...policies.map(({ id }) => id), preorderPolicy.id].map((pageVersionId) => ({
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
            { total, depositAmount, campaignId: campaign.id },
          )
          await orderExpiry.scheduleOrderExpiry(tx, order.id, reservedUntil)
          if (customerId) {
            const { recipientName, phone, email, provinceCode, wardCode, streetAddress } = address
            await tx.customer.update({
              where: { id: customerId },
              data: { lastShippingAddress: { recipientName, phone, email, provinceCode, wardCode, streetAddress } },
            })
          }

          const checkoutUrl = await createOrderPaymentLink(tx, { payments, siteUrl, req }, order, {
            purpose: 'deposit',
            amount: depositAmount,
            description: `Đặt cọc đơn hàng #${order.code}`,
            expiresAt: reservedUntil,
          })
          return { code: order.code, token, checkoutUrl, reservedUntil: reservedUntil.toISOString() }
        },
        // Gọi cổng thanh toán nằm trong transaction nên cần lâu hơn mặc định 5 giây.
        { timeout: 30_000, maxWait: 10_000 },
      )
      res.status(201).json(body)
    })
}
