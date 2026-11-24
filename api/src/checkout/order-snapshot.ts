import { ErrorCode } from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { DbClient } from '../db.ts'
import type { PaymentPurpose } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { paymentResultUrl, type OrderLineImage } from '../orders/orders.ts'
import type { PaymentGateway } from '../payments/gateway.ts'
import type { CartVariant } from './live-variants.ts'

/** Ảnh gắn với biến thể, không có thì ảnh đầu tiên của sản phẩm. */
export function storedImageOf({ snapshot, variant }: CartVariant): OrderLineImage | null {
  const images = snapshot?.images ?? []
  const image = images.find((i) => variant && i.variantIds.includes(variant.id)) ?? images[0]
  if (!image) return null
  const { key, contentType, width, height, widths, alt } = image
  return { key, contentType, width, height, widths, alt }
}

/** Phiên bản đang xuất bản của các trang chính sách gắn với sản phẩm trong đơn. */
export async function livePolicyVersions(db: DbClient, variants: Iterable<CartVariant>) {
  const pageIds = new Set([...variants].flatMap((v) => (v.variant ? (v.snapshot?.policyPageIds ?? []) : [])))
  const pages = await db.contentPage.findMany({
    where: { id: { in: [...pageIds] }, kind: 'policy' },
    select: { slug: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { id: true, title: true } } },
    orderBy: { slug: 'asc' },
  })
  return pages.flatMap(({ slug, versions }) => versions.map(({ id, title }) => ({ id, slug, title })))
}

/**
 * Tạo link thanh toán ở cổng cho đơn vừa tạo và lưu mã bên cổng (ghi nhận tiền về, `refresh=1`, job hết hạn). Gọi sau
 * cùng trong transaction đặt mua hay đặt trước: cổng lỗi thì log qua `log` rồi 502, và cả đơn rollback. Trang quay về
 * không mang token: cổng không được thấy link xem và hủy đơn.
 *
 * `clientIp` là `req.ip` nguyên dạng: hàm tự bỏ tiền tố IPv4-mapped và dùng `127.0.0.1` khi không có.
 */
export async function createOrderPaymentLink(
  tx: DbClient,
  {
    payments,
    siteUrl,
    clientIp,
    log,
  }: { payments: PaymentGateway; siteUrl: string; clientIp: string | undefined; log: Logger },
  order: { id: string; code: number },
  link: { purpose: PaymentPurpose; amount: number; description: string; expiresAt: Date },
) {
  const created = await payments
    .createLink({
      orderCode: order.code,
      purpose: link.purpose,
      amount: link.amount,
      description: link.description,
      returnUrl: paymentResultUrl(siteUrl, order.code).toString(),
      expiresAt: link.expiresAt,
      // `trust proxy` (app.ts) cho IP thật sau Caddy; bỏ tiền tố IPv4-mapped của Node.
      clientIp: (clientIp || '127.0.0.1').replace(/^::ffff:/, ''),
    })
    .catch((err: unknown) => {
      log.error({ err, orderCode: order.code }, 'Không tạo được link thanh toán')
      throw new AppError(502, ErrorCode.BAD_GATEWAY, 'Chưa tạo được thanh toán, thử lại')
    })
  await tx.paymentLink.create({
    data: {
      orderId: order.id,
      purpose: link.purpose,
      amount: link.amount,
      gatewayReference: created.gatewayReference,
      expiresAt: link.expiresAt,
    },
  })
  return created.checkoutUrl
}
