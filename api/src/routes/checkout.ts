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
} from '@ecommerce/shared'
import { wardName } from '@ecommerce/shared/wards'
import type { AppDeps } from '../app.ts'
import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import { optionalAuth } from '../auth/require-auth.ts'
import { findCurrentPrivacyPolicy } from '../content/pages.ts'
import { cartVariants, type CartVariant } from '../checkout/live-variants.ts'
import { enforcePendingOrderLimit } from '../checkout/pending-orders.ts'
import type { DbClient } from '../db.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { parse } from '../http/validation.ts'
import { imageRenditions } from '../media/images.ts'
import { paymentResultUrl, recordOrderEvent, type OrderLineImage } from '../orders/orders.ts'
import { requireShippingFeeConfig } from '../shipping/shipping-fees.ts'
import { inStockIds, reserveStock } from '../stock/stock.ts'

/** Ảnh gắn với biến thể, không có thì ảnh đầu tiên của sản phẩm. */
function storedImageOf({ snapshot, variant }: CartVariant): OrderLineImage | null {
  const images = snapshot?.images ?? []
  const image = images.find((i) => variant && i.variantIds.includes(variant.id)) ?? images[0]
  if (!image) return null
  const { key, contentType, width, height, widths, alt } = image
  return { key, contentType, width, height, widths, alt }
}

/** Phiên bản đang xuất bản của các trang chính sách gắn với sản phẩm trong đơn. */
async function livePolicyVersions(db: DbClient, variants: Iterable<CartVariant>) {
  const pageIds = new Set([...variants].flatMap((v) => (v.variant ? (v.snapshot?.policyPageIds ?? []) : [])))
  const pages = await db.contentPage.findMany({
    where: { id: { in: [...pageIds] }, kind: 'policy' },
    select: { slug: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, title: true } } },
    orderBy: { slug: 'asc' },
  })
  return pages.flatMap(({ slug, versions }) => versions.map(({ id, title }) => ({ id, slug, title })))
}

/** Đặt mua của khách, không cần đăng nhập; kèm access token khách thì đơn gắn với tài khoản. */
export function checkoutRoutes({ prisma, storage, payments, siteUrl, jwtSecret }: AppDeps) {
  const customerSession = optionalAuth(new TextEncoder().encode(jwtSecret), 'customer')
  return Router()
    .post('/quote', async (req, res) => {
      const input = parse(CheckoutQuoteRequest, req.body)
      const config = await requireShippingFeeConfig(prisma)
      const ids = input.lines.map((l) => l.variantId)
      const [variants, stocked] = await Promise.all([cartVariants(prisma, ids), inStockIds(prisma, ids)])
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
      const shippingFee = input.provinceCode === undefined ? null : shippingFeeFor(config, input.provinceCode, subtotal)

      const body: CheckoutQuote = {
        lines,
        groundShippingOnly: [...variants.values()].some((v) => v.variant !== null && v.snapshot?.groundShippingOnly),
        subtotal,
        freeShippingThreshold: config.freeShippingThreshold,
        shippingFee,
        total: shippingFee === null ? null : subtotal + shippingFee,
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
          await enforcePendingOrderLimit(tx, res, address)
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
            }
          })
          const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0)
          const shippingFee = shippingFeeFor(config, address.provinceCode, subtotal)
          const total = subtotal + shippingFee
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
              lookupTokenHash: hashOpaqueToken(token),
              reservedUntil,
              lines: { create: lines },
              policyVersions: { create: policies.map(({ id }) => ({ pageVersionId: id })) },
            },
          })
          await recordOrderEvent(
            tx,
            order.id,
            'created',
            { type: 'customer', customerId: customerId ?? undefined },
            { total },
          )

          // Gọi cổng sau cùng, khi mọi thứ khác đã ghi được; cổng lỗi thì cả đơn rollback.
          // Trang quay về không mang token: cổng không được thấy link xem và hủy đơn.
          const returnUrl = paymentResultUrl(siteUrl, order.code).toString()
          const link = await payments
            .createLink({
              orderCode: order.code,
              amount: total,
              description: `DH${order.code}`,
              returnUrl,
              cancelUrl: returnUrl,
              expiresAt: reservedUntil,
            })
            .catch((err: unknown) => {
              req.log.error({ err, orderCode: order.code }, 'Không tạo được link thanh toán')
              throw new AppError(502, ErrorCode.BAD_GATEWAY, 'Chưa tạo được thanh toán, thử lại')
            })

          return { code: order.code, token, checkoutUrl: link.checkoutUrl, reservedUntil: reservedUntil.toISOString() }
        },
        // Gọi cổng thanh toán nằm trong transaction nên cần lâu hơn mặc định 5 giây.
        { timeout: 30_000, maxWait: 10_000 },
      )
      res.status(201).json(body)
    })
}
