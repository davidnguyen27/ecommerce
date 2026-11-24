import { Router } from 'express'
import {
  CheckoutQuoteRequest,
  CheckoutRequest,
  ErrorCode,
  RESERVATION_MINUTES,
  provinceName,
  shippingFeeFor,
  type CheckoutConflictDetails,
  type CheckoutQuote,
  type CheckoutResult,
  type QuoteLine,
  type VoucherQuote,
} from '@ecommerce/shared'
import { wardName } from '@ecommerce/shared/wards'
import type { AppDeps } from '../app.ts'
import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import { optionalAuth } from '../auth/require-auth.ts'
import { findCurrentPrivacyPolicy } from '../content/pages.ts'
import { cartVariants } from '../checkout/live-variants.ts'
import { createOrderPaymentLink, livePolicyVersions, storedImageOf } from '../checkout/order-snapshot.ts'
import { enforcePendingOrderLimit } from '../checkout/pending-orders.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { parse } from '../http/validation.ts'
import { imageRenditions } from '../media/images.ts'
import { recordOrderEvent } from '../orders/orders.ts'
import { requireShippingFeeConfig } from '../shipping/shipping-fees.ts'
import { enoughStockIds, reserveStock } from '../stock/stock.ts'
import { applyVoucherToOrder, quoteVoucher, voucherSnapshot, type VoucherLine } from '../vouchers/apply.ts'

/** Đặt mua của khách, không cần đăng nhập; kèm access token khách thì đơn gắn với tài khoản. */
export function checkoutRoutes({ prisma, storage, payments, siteUrl, jwtSecret, orderExpiry }: AppDeps) {
  const customerSession = optionalAuth(new TextEncoder().encode(jwtSecret), 'customer')
  return Router()
    .post('/quote', async (req, res) => {
      const input = parse(CheckoutQuoteRequest, req.body)
      const config = await requireShippingFeeConfig(prisma)
      const ids = input.lines.map((l) => l.variantId)
      const [variants, stocked] = await Promise.all([cartVariants(prisma, ids), enoughStockIds(prisma, input.lines)])
      const policies = await livePolicyVersions(prisma, variants.values())

      const lines = input.lines.map(({ variantId, quantity }): QuoteLine => {
        const found = variants.get(variantId) ?? { snapshot: null, variant: null }
        const { snapshot, variant } = found
        const inStock = variant !== null && stocked.has(variantId)
        const image = storedImageOf(found)
        return {
          variantId,
          quantity,
          product: snapshot && { slug: snapshot.slug, name: snapshot.name },
          sku: variant?.sku ?? null,
          attributes: variant?.attributes ?? null,
          image: image && { ...imageRenditions(storage, image), alt: image.alt },
          price: variant?.price ?? null,
          compareAtPrice: variant?.compareAtPrice ?? null,
          lineTotal: variant && inStock ? variant.price * quantity : null,
          discontinued: variant === null,
          inStock,
        }
      })
      const subtotal = lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)

      let voucher: VoucherQuote | null = null
      if (input.voucherCode !== undefined) {
        // Chỉ các dòng mua được (còn bán, còn hàng) tính vào tiền hàng, như `subtotal`.
        const buyable = lines.flatMap(({ variantId, quantity, lineTotal, price }): VoucherLine[] => {
          const snapshot = variants.get(variantId)?.snapshot
          return lineTotal === null || !snapshot || price === null
            ? []
            : [{ variantId, brandId: snapshot.brandId, categoryId: snapshot.categoryId, price, quantity }]
        })
        voucher = await quoteVoucher(prisma, req, res, input.voucherCode, {
          saleType: 'standard',
          lines: buyable,
          customer: { email: input.email, phone: input.phone },
        })
      }
      const discount = voucher?.applied ? voucher.discount : 0
      // Ngưỡng miễn phí giao so với tiền hàng sau giảm (spec M5).
      const feeFor = (goods: number) =>
        input.provinceCode === undefined ? null : shippingFeeFor(config, input.provinceCode, goods)
      const shippingFee = feeFor(subtotal - discount)
      const shippingFeeWithoutVoucher = feeFor(subtotal)

      const body: CheckoutQuote = {
        lines,
        groundShippingOnly: [...variants.values()].some((v) => v.variant !== null && v.snapshot?.groundShippingOnly),
        subtotal,
        voucher,
        discount,
        freeShippingThreshold: config.freeShippingThreshold,
        shippingFee,
        total: shippingFee === null ? null : subtotal - discount + shippingFee,
        shippingFeeWithoutVoucher,
        totalWithoutVoucher: shippingFeeWithoutVoucher === null ? null : subtotal + shippingFeeWithoutVoucher,
        policies: policies.map(({ slug, title }) => ({ slug, title })),
      }
      res.json(body)
    })
    .post('/', customerSession, async (req, res) => {
      const input = parse(CheckoutRequest, req.body)
      const { address, invoice } = input
      const customerId = req.auth?.subjectId ?? null
      if (!customerId && input.acceptPrivacyPolicy !== true) {
        throw invalidField('acceptPrivacyPolicy', 'Cần đồng ý với chính sách bảo mật để đặt mua')
      }
      const ward = wardName(address.provinceCode, address.wardCode)
      if (!ward) throw invalidField('address.wardCode', 'Phường/xã không thuộc tỉnh/thành đã chọn')
      await enforceRateLimits(
        prisma,
        res,
        [{ limit: RATE_LIMITS.checkoutPerIp, subject: String(req.ip) }],
        'Bạn đã đặt mua quá nhiều lần, vui lòng thử lại sau',
      )
      const token = newOpaqueToken()

      // Một transaction: dòng sai, thiếu hàng hay cổng lỗi đều rollback, không còn đơn hay hàng giữ nào.
      const body = await prisma.$transaction(
        async (tx): Promise<CheckoutResult> => {
          const config = await requireShippingFeeConfig(tx)
          await enforcePendingOrderLimit(tx, address)
          // Khách vãng lai đồng ý với phiên bản hiện hành, đọc trong cùng transaction như lúc đăng ký.
          const privacyPolicy = customerId ? null : await findCurrentPrivacyPolicy(tx)
          if (!customerId && !privacyPolicy) {
            throw new AppError(
              503,
              ErrorCode.SERVICE_UNAVAILABLE,
              'Chưa thể đặt mua vì chính sách bảo mật chưa được công bố',
            )
          }
          const variants = await cartVariants(
            tx,
            input.lines.map((l) => l.variantId),
          )
          const problems: CheckoutConflictDetails['lines'] = []
          for (const line of input.lines) {
            const variant = variants.get(line.variantId)?.variant
            if (!variant) problems.push({ variantId: line.variantId, change: { kind: 'discontinued' } })
            else if (variant.price !== line.price) {
              problems.push({
                variantId: line.variantId,
                change: { kind: 'price', from: line.price, to: variant.price },
              })
            }
          }
          // Giữ cả khi đã có dòng sai, để khách thấy mọi thay đổi trong một lần; lỗi thì rollback nên không giữ gì.
          const reserved = await reserveStock(
            tx,
            input.lines.filter((line) => !problems.some((p) => p.variantId === line.variantId)),
          )
          if (!reserved.ok) {
            for (const variantId of reserved.shortVariantIds)
              problems.push({ variantId, change: { kind: 'out_of_stock' } })
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

          // Tới đây mọi dòng đều có biến thể đang bán trong snapshot đang xuất bản.
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
              // `reserveStock` ở trên đã giữ đủ số lượng cho mọi dòng.
              reservedQuantity: line.quantity,
            }
          })
          const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0)

          // Mã kiểm sau khi các dòng đã đúng: tiền giảm phụ thuộc giá và số lượng. Khóa dòng mã sau dòng biến thể.
          const applied =
            input.voucherCode === undefined
              ? null
              : await applyVoucherToOrder(tx, input.voucherCode, {
                  saleType: 'standard',
                  lines: lines.map(({ variantId, price, quantity }) => {
                    const snapshot = variants.get(variantId)!.snapshot!
                    return { variantId, brandId: snapshot.brandId, categoryId: snapshot.categoryId, price, quantity }
                  }),
                  customer: { email: address.email, phone: address.phone },
                  seenDiscount: input.discount,
                  withoutVoucher: {
                    totalWithoutVoucher: subtotal + shippingFeeFor(config, address.provinceCode, subtotal),
                  },
                  detailsOf: (voucher): CheckoutConflictDetails => ({ lines: [], voucher }),
                })
          const discount = applied ? Number(applied.discount) : 0
          const lineDiscounts = new Map(applied?.lines.map((l) => [l.variantId, l.discount]))
          const shippingFee = shippingFeeFor(config, address.provinceCode, subtotal - discount)
          const total = subtotal - discount + shippingFee
          const policies = await livePolicyVersions(tx, variants.values())
          const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60_000)

          const order = await tx.order.create({
            data: {
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
              reservedUntil,
              lines: { create: lines.map((line) => ({ ...line, discount: lineDiscounts.get(line.variantId) ?? 0n })) },
              policyVersions: { create: policies.map(({ id }) => ({ pageVersionId: id })) },
            },
          })
          await recordOrderEvent(
            tx,
            order.id,
            'created',
            { type: 'customer', customerId: customerId ?? undefined },
            { total, ...(applied && { voucherCode: applied.voucher.code, discount }) },
          )
          await orderExpiry.scheduleOrderExpiry(tx, order.id, reservedUntil)
          // Trang đặt mua lần sau tự điền; cùng transaction nên đặt hỏng thì địa chỉ cũ giữ nguyên.
          if (customerId) {
            const { recipientName, phone, email, provinceCode, wardCode, streetAddress } = address
            await tx.customer.update({
              where: { id: customerId },
              data: { lastShippingAddress: { recipientName, phone, email, provinceCode, wardCode, streetAddress } },
            })
          }

          // Gọi cổng sau cùng, khi mọi thứ khác đã ghi được; cổng lỗi thì cả đơn rollback.
          const checkoutUrl = await createOrderPaymentLink(
            tx,
            { payments, siteUrl, clientIp: req.ip, log: req.log },
            order,
            {
              purpose: 'full',
              amount: total,
              description: `Thanh toán đơn hàng #${order.code}`,
              expiresAt: reservedUntil,
            },
          )

          return { code: order.code, token, checkoutUrl, reservedUntil: reservedUntil.toISOString() }
        },
        // Gọi cổng thanh toán nằm trong transaction nên cần lâu hơn mặc định 5 giây.
        { timeout: 30_000, maxWait: 10_000 },
      )
      res.status(201).json(body)
    })
}
