import { ErrorCode, PublicImage, type AttributeValues, type PublicOrder } from '@ecommerce/shared'
import { z } from 'zod'
import type { Storage } from '../adapters/storage.ts'
import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import type { DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { StoredImage, imageRenditions } from '../media/images.ts'

/** Ảnh đại diện lưu trên dòng đơn: file trên bucket public kèm `alt`. */
export const OrderLineImage = StoredImage.extend({ alt: z.string() })
export type OrderLineImage = z.infer<typeof OrderLineImage>

/**
 * Loại sự kiện trong lịch sử đơn: `paid` khi đủ tiền, `payment_flagged` khi khoản tiền cần đối soát.
 * `cancelled` khi đơn chưa thanh toán bị hủy (`data.reason` là `OrderCancelReason`, kể cả hết hạn).
 * Các ticket sau thêm giao hàng.
 */
export type OrderEventKind =
  | 'created'
  | 'paid'
  | 'payment_flagged'
  | 'cancelled'
  /** Kế toán khôi phục đơn đã hủy khi tiền về đủ (đối soát). */
  | 'restored'
  /** Kế toán đóng mục cần đối soát vì đã xử lý ngoài hệ thống. */
  | 'reconciliation_resolved'

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

/** Link tra cứu đơn trên website, gửi khách qua email. */
export function orderLookupUrl(siteUrl: string, code: number, token: string) {
  const url = new URL(`/don-hang/${code}`, siteUrl)
  url.searchParams.set('token', token)
  return url
}

/**
 * Trang kết quả thanh toán, nơi cổng đưa khách quay về. Không chứa token: cổng không được thấy link xem và hủy đơn;
 * trình duyệt giữ token từ response đặt mua.
 */
export function paymentResultUrl(siteUrl: string, code: number) {
  const url = new URL(`/don-hang/${code}`, siteUrl)
  url.searchParams.set('ket-qua', '1')
  return url
}

/** Cấp thêm một token tra cứu cho đơn (chỉ lưu hash) và trả link, để gửi trong email. */
export async function issueOrderLookupUrl(db: DbClient, siteUrl: string, order: { id: string; code: number }) {
  const token = newOpaqueToken()
  await db.orderLookupToken.create({ data: { orderId: order.id, tokenHash: hashOpaqueToken(token) } })
  return orderLookupUrl(siteUrl, order.code, token)
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
  const hash = hashOpaqueToken(token)
  const order = await db.order.findFirst({
    where: { code: Number(code), OR: [{ lookupTokenHash: hash }, { lookupTokens: { some: { tokenHash: hash } } }] },
    include: ORDER_VIEW_INCLUDE,
  })
  if (!order) throw notFound()
  return order
}

/**
 * Đơn theo mã của khách đang đăng nhập. Đơn của người khác cũng là 404, như mã lạ, để không lộ đơn nào tồn tại.
 * `code` là chuỗi từ URL.
 */
export async function findCustomerOrder(db: DbClient, code: string, customerId: string) {
  if (!/^\d{1,9}$/.test(code)) throw notFound()
  const order = await db.order.findFirst({ where: { code: Number(code), customerId }, include: ORDER_VIEW_INCLUDE })
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
    cancelReason: order.cancelReason,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
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
