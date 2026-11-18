import {
  ErrorCode,
  PublicImage,
  type AttributeValues,
  type OrderPreorder,
  type PublicOrder,
  type PublicRefund,
} from '@ecommerce/shared'
import { z } from 'zod'
import type { Storage } from '../adapters/storage.ts'
import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import type { DbClient } from '../db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { StoredImage, imageRenditions } from '../media/images.ts'
import { isoDay } from './format.ts'

/**
 * Khoản hoàn như khách thấy. Khoản thất bại không hiện: khách chỉ cần biết tiền đang về hay đã về; kế toán tạo lại
 * khoản mới nếu cần.
 */
export function toPublicRefunds(
  refunds: readonly { amount: bigint; status: string; createdAt: Date; completedAt: Date | null }[],
): PublicRefund[] {
  return refunds
    .filter((r) => r.status !== 'failed')
    .map((r) => ({
      amount: Number(r.amount),
      status: r.status === 'succeeded' ? 'refunded' : 'refunding',
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    }))
}

/** Ảnh đại diện lưu trên dòng đơn: file trên bucket public kèm `alt`. */
export const OrderLineImage = StoredImage.extend({ alt: z.string() })
export type OrderLineImage = z.infer<typeof OrderLineImage>

/**
 * Loại sự kiện trong lịch sử đơn: `paid` khi đủ tiền, `payment_flagged` khi khoản tiền cần đối soát.
 * `cancelled` khi đơn chưa thanh toán bị hủy (`data.reason` là `OrderCancelReason`, kể cả hết hạn).
 * `preparing` khi nhân viên kho bắt đầu soạn, `handed_over` khi bàn giao vận chuyển (`data` có `carrier`,
 * `trackingNumber`). `delivered` khi đã giao (đơn hoàn tất), `delivery_failed` khi giao thất bại (đơn vẫn xử lý).
 */
export type OrderEventKind =
  | 'created'
  | 'paid'
  /** Đơn đặt trước nhận đủ tiền cọc (M4). */
  | 'deposit_paid'
  /** Phiếu nhập giữ một phần hàng về cho đơn đặt trước (`data`: biến thể, số lượng, phiếu nhập; ADR 0013). */
  | 'stock_allocated'
  /** Đơn đặt trước đã được giữ đủ hàng: bắt đầu hạn trả phần còn lại. */
  | 'arrived'
  /** Đã gửi email nhắc trả phần còn lại (ticket 08). */
  | 'remainder_reminded'
  /** Quá hạn trả phần còn lại: gắn cờ, không hủy đơn (`data.remainderDueAt`). */
  | 'remainder_overdue'
  /** Nhân viên đổi thời gian giao dự kiến của đợt, khách được báo (`data.before`, `data.after`; ticket 09). */
  | 'delivery_changed'
  | 'payment_flagged'
  | 'cancelled'
  | 'preparing'
  | 'handed_over'
  /** Kế toán khôi phục đơn đã hủy khi tiền về đủ (đối soát). */
  | 'restored'
  /** Kế toán đóng mục cần đối soát: đã xử lý ngoài hệ thống, hoặc bằng hoàn tiền (`data.resolution = refunded`). */
  | 'reconciliation_resolved'
  /** Một khoản hoàn được tạo, chờ kế toán thực hiện (`data`: `refundId`, `amount`, `origin`; ADR 0014). */
  | 'refund_created'
  /** Khoản hoàn đã xong: thủ công, cổng báo thành công, hoặc kế toán chốt. */
  | 'refund_succeeded'
  /** Khoản hoàn thất bại; tạo lại được. */
  | 'refund_failed'
  | 'delivered'
  | 'delivery_failed'
  /** Giao lại đơn giao thất bại với mã vận đơn mới (`data.previous`: mã cũ; M6a). */
  | 'redelivered'
  /** Kho nhận hàng hoàn về: từng dòng nhập lại tồn hay hỏng/mất (`data.lines`). */
  | 'returned_to_stock'
  /** Giao lại từ kho: giữ hàng lại cho đơn, quay về chưa chuẩn bị. */
  | 'restocked_for_redelivery'
  /** Hủy đơn đóng các yêu cầu hủy của khách (`data.requestCodes`; M6b). */
  | 'support_resolved'

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
  // Thời gian giao dự kiến hiện tại của đợt, cạnh lời hẹn lúc đặt (ticket 09).
  preorderCampaign: { select: { deliveryFrom: true, deliveryTo: true } },
  // Đã nhận và các khoản hoàn khách thấy (ADR 0014).
  paymentTransactions: { select: { amount: true } },
  refunds: {
    select: { amount: true, status: true, createdAt: true, completedAt: true },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.OrderInclude

export type OrderForView = Prisma.OrderGetPayload<{ include: typeof ORDER_VIEW_INCLUDE }>

export const orderNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')

/** Mã đơn từ URL thành số; chuỗi không phải mã đơn là 404, như mã không có đơn nào. */
export function parseOrderCode(code: string) {
  if (!/^\d{1,9}$/.test(code)) throw orderNotFound()
  return Number(code)
}

/**
 * Đơn theo mã và token tra cứu. Mã lạ, thiếu token hay token sai đều là 404 như nhau, để không lộ đơn nào tồn tại.
 * `code` là chuỗi từ URL.
 */
export async function findOrderByToken(db: DbClient, code: string, token: string | undefined) {
  if (!token) throw orderNotFound()
  const orderCode = parseOrderCode(code)
  const hash = hashOpaqueToken(token)
  const order = await db.order.findFirst({
    where: { code: orderCode, OR: [{ lookupTokenHash: hash }, { lookupTokens: { some: { tokenHash: hash } } }] },
    include: ORDER_VIEW_INCLUDE,
  })
  if (!order) throw orderNotFound()
  return order
}

/**
 * Đơn theo mã của khách đang đăng nhập. Đơn của người khác cũng là 404, như mã lạ, để không lộ đơn nào tồn tại.
 * `code` là chuỗi từ URL.
 */
export async function findCustomerOrder(db: DbClient, code: string, customerId: string) {
  const order = await db.order.findFirst({
    where: { code: parseOrderCode(code), customerId },
    include: ORDER_VIEW_INCLUDE,
  })
  if (!order) throw orderNotFound()
  return order
}

/** Đơn đặt trước đã cọc mà chưa trả đủ: đang chờ hàng về hoặc chờ phần còn lại. */
export const DEPOSITED_PREORDER = {
  kind: 'preorder',
  status: 'processing',
  paymentStatus: 'deposit_paid',
} as const satisfies Prisma.OrderWhereInput

/** Phần còn lại của đơn đặt trước: tổng phải trả trừ tiền cọc, gồm phí giao (GLOSSARY "Phần còn lại"). */
export const remainingOf = (order: { total: bigint; depositAmount: bigint | null }) =>
  order.total - order.depositAmount!

/** Phần đặt trước của đơn; `null` với đơn hàng sẵn (check `order_preorder_check` bảo đảm đủ trường). */
export function preorderOf(
  order: Pick<
    OrderForView,
    | 'kind'
    | 'preorderCampaignId'
    | 'total'
    | 'depositPercent'
    | 'depositAmount'
    | 'deliveryFrom'
    | 'deliveryTo'
    | 'remainderDays'
    | 'depositPaidAt'
    | 'arrivedAt'
    | 'remainderDueAt'
    | 'remainderOverdueAt'
    | 'lines'
    | 'preorderCampaign'
  >,
): OrderPreorder | null {
  const { depositPercent, depositAmount, deliveryFrom, deliveryTo, remainderDays } = order
  if (order.kind !== 'preorder' || depositPercent === null || depositAmount === null) return null
  if (deliveryFrom === null || deliveryTo === null || remainderDays === null) return null
  const quantity = order.lines.reduce((sum, line) => sum + line.quantity, 0)
  return {
    campaignId: order.preorderCampaignId!,
    // Đã về đủ thì là đủ, kể cả khi số đang giữ đã về 0 sau bàn giao vận chuyển.
    arrivedQuantity: order.arrivedAt ? quantity : order.lines.reduce((sum, line) => sum + line.reservedQuantity, 0),
    quantity,
    arrivedAt: order.arrivedAt?.toISOString() ?? null,
    remainderDueAt: order.remainderDueAt?.toISOString() ?? null,
    remainderOverdueAt: order.remainderOverdueAt?.toISOString() ?? null,
    currentDeliveryFrom: isoDay(order.preorderCampaign?.deliveryFrom ?? deliveryFrom),
    currentDeliveryTo: isoDay(order.preorderCampaign?.deliveryTo ?? deliveryTo),
    depositPercent,
    depositAmount: Number(depositAmount),
    remainingAmount: Number(remainingOf(order)),
    deliveryFrom: isoDay(deliveryFrom),
    deliveryTo: isoDay(deliveryTo),
    remainderDays,
    depositPaidAt: order.depositPaidAt?.toISOString() ?? null,
  }
}

export function toPublicOrder(storage: Storage, order: OrderForView): PublicOrder {
  const image = (value: Prisma.JsonValue): PublicImage | null => {
    if (value === null) return null
    const stored = OrderLineImage.parse(value)
    return { ...imageRenditions(storage, stored), alt: stored.alt }
  }
  return {
    code: order.code,
    kind: order.kind,
    preorder: preorderOf(order),
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    createdAt: order.createdAt.toISOString(),
    reservedUntil: order.reservedUntil?.toISOString() ?? null,
    cancelReason: order.cancelReason,
    cancelCause: order.cancelCause,
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
      discount: Number(line.discount),
    })),
    subtotal: Number(order.subtotal),
    voucherCode: order.voucherCode,
    discount: Number(order.discount),
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
    shipment:
      order.carrier === null || order.trackingNumber === null || order.handedOverAt === null
        ? null
        : {
            carrier: order.carrier,
            trackingNumber: order.trackingNumber,
            handedOverAt: order.handedOverAt.toISOString(),
          },
    received: order.paymentTransactions.reduce((sum, t) => sum + Number(t.amount), 0),
    // Khoản thất bại không hiện: khách chỉ cần biết tiền đang về hay đã về; kế toán tạo lại khoản mới nếu cần.
    refunds: toPublicRefunds(order.refunds),
  }
}
