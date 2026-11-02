import { ErrorCode, PublicImage, type AttributeValues, type PublicOrder } from '@ecommerce/shared'
import { z } from 'zod'
import type { Storage } from '../adapters/storage.ts'
import { hashOpaqueToken } from '../auth/opaque-token.ts'
import type { DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { StoredImage, imageRenditions } from '../media/images.ts'

/** Ảnh đại diện lưu trên dòng đơn: file trên bucket public kèm `alt`. */
export const OrderLineImage = StoredImage.extend({ alt: z.string() })
export type OrderLineImage = z.infer<typeof OrderLineImage>

/** Loại sự kiện trong lịch sử đơn; các ticket sau thêm thanh toán, hủy, hết hạn, giao hàng. */
export type OrderEventKind = 'created'

/** Ai làm: nhân viên, khách (có id khi đã đăng nhập) hoặc hệ thống. */
export type OrderEventActor =
  { type: 'staff'; staffId: string } | { type: 'customer'; customerId?: string } | { type: 'system' }

/** Ghi một sự kiện vào lịch sử đơn (append-only). Gọi trong transaction của thay đổi trạng thái. */
export async function recordOrderEvent(
  db: DbClient,
  orderId: string,
  kind: OrderEventKind,
  actor: OrderEventActor,
  data: Prisma.InputJsonObject = {},
) {
  await db.orderEvent.create({
    data: {
      orderId,
      kind,
      actor: actor.type,
      staffId: actor.type === 'staff' ? actor.staffId : null,
      customerId: actor.type === 'customer' ? (actor.customerId ?? null) : null,
      data,
    },
  })
}

/** Link tra cứu đơn trên website, gửi khách và dùng làm trang quay về từ cổng thanh toán. */
export function orderLookupUrl(siteUrl: string, code: number, token: string) {
  const url = new URL(`/don-hang/${code}`, siteUrl)
  url.searchParams.set('token', token)
  return url
}

/** Đủ để dựng `PublicOrder`. */
export const ORDER_VIEW_INCLUDE = {
  lines: { orderBy: { position: 'asc' } },
  policyVersions: { include: { pageVersion: { include: { page: { select: { slug: true } } } } } },
  privacyPolicyVersion: { select: { version: true } },
} as const satisfies Prisma.OrderInclude

export type OrderForView = Prisma.OrderGetPayload<{ include: typeof ORDER_VIEW_INCLUDE }>

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')

/**
 * Đơn theo mã và token tra cứu. Mã lạ, thiếu token hay token sai đều là 404 như nhau, để không lộ đơn nào tồn tại.
 * `code` là chuỗi từ URL.
 */
export async function findOrderByToken(db: DbClient, code: string, token: string | undefined) {
  if (!token || !/^\d{1,9}$/.test(code)) throw notFound()
  const order = await db.order.findFirst({
    where: { code: Number(code), lookupTokenHash: hashOpaqueToken(token) },
    include: ORDER_VIEW_INCLUDE,
  })
  if (!order) throw notFound()
  return order
}

export function toPublicOrder(storage: Storage, order: OrderForView): PublicOrder {
  const image = (value: Prisma.JsonValue): PublicImage | null => {
    if (value === null) return null
    const stored = OrderLineImage.parse(value)
    return { ...imageRenditions(storage, stored), alt: stored.alt }
  }
  return {
    code: order.code,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    createdAt: order.createdAt.toISOString(),
    reservedUntil: order.reservedUntil?.toISOString() ?? null,
    address: {
      recipientName: order.recipientName,
      phone: order.phone,
      email: order.email,
      provinceCode: order.provinceCode,
      provinceName: order.provinceName,
      wardCode: order.wardCode,
      wardName: order.wardName,
      streetAddress: order.streetAddress,
    },
    note: order.note,
    lines: order.lines.map((line) => ({
      variantId: line.variantId,
      sku: line.sku,
      productName: line.productName,
      attributes: line.attributes as AttributeValues,
      image: image(line.image),
      price: Number(line.price),
      quantity: line.quantity,
      lineTotal: Number(line.price) * line.quantity,
    })),
    subtotal: Number(order.subtotal),
    shippingFee: Number(order.shippingFee),
    total: Number(order.total),
    policies: order.policyVersions
      .map(({ pageVersion }) => ({
        slug: pageVersion.page.slug,
        title: pageVersion.title,
        version: pageVersion.version,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
    privacyConsent: order.privacyPolicyVersion && {
      policyVersion: order.privacyPolicyVersion.version,
      consentedAt: order.createdAt.toISOString(),
    },
    invoice:
      order.invoiceCompanyName === null || order.invoiceTaxCode === null || order.invoiceAddress === null
        ? null
        : { companyName: order.invoiceCompanyName, taxCode: order.invoiceTaxCode, address: order.invoiceAddress },
  }
}
