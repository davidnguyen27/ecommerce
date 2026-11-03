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
import { cartVariants, type CartVariant } from '../checkout/live-variants.ts'
import type { DbClient } from '../db.ts'
import { AppError, invalidField } from '../http/errors.ts'
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
async function livePolicyVersionIds(db: DbClient, pageIds: readonly string[]) {
  const pages = await db.contentPage.findMany({
    where: { id: { in: [...pageIds] }, kind: 'policy' },
    select: { versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true } } },
  })
  return pages.flatMap((page) => page.versions.map((v) => v.id))
}

/** Đặt mua của khách, không cần đăng nhập. */
export function checkoutRoutes({ prisma, storage, payments, siteUrl, orderExpiry }: AppDeps) {
  return Router()
    .post('/quote', async (req, res) => {
      const input = parse(CheckoutQuoteRequest, req.body)
      const config = await requireShippingFeeConfig(prisma)
      const ids = input.lines.map((l) => l.variantId)
      const [variants, stocked] = await Promise.all([cartVariants(prisma, ids), inStockIds(prisma, ids)])

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
      }
      res.json(body)
    })
    .post('/', async (req, res) => {
      const input = parse(CheckoutRequest, req.body)
      const { address } = input
      const ward = wardName(address.provinceCode, address.wardCode)
      if (!ward) throw invalidField('address.wardCode', 'Phường/xã không thuộc tỉnh/thành đã chọn')
      const token = newOpaqueToken()

      // Một transaction: dòng sai, thiếu hàng hay cổng lỗi đều rollback, không còn đơn hay hàng giữ nào.
      const body = await prisma.$transaction(
        async (tx): Promise<CheckoutResult> => {
          const config = await requireShippingFeeConfig(tx)
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
          const pageIds = new Set([...variants.values()].flatMap((v) => v.snapshot?.policyPageIds ?? []))
          const policyVersionIds = await livePolicyVersionIds(tx, [...pageIds])
          const reservedUntil = new Date(Date.now() + RESERVATION_MINUTES * 60_000)

          const order = await tx.order.create({
            data: {
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
              policyVersions: { create: policyVersionIds.map((pageVersionId) => ({ pageVersionId })) },
            },
          })
          await recordOrderEvent(tx, order.id, 'created', { type: 'customer' }, { total })
          await orderExpiry.scheduleOrderExpiry(tx, order.id, reservedUntil)

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
