import { ErrorCode } from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { DbClient } from '../db.ts'
import type { PaymentPurpose } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { paymentResultUrl, type OrderLineImage } from '../orders/orders.ts'
import type { PaymentGateway } from '../payments/gateway.ts'
import type { CartVariant } from './live-variants.ts'

/** The variant's image, else the product's first image. */
export function storedImageOf({ snapshot, variant }: CartVariant): OrderLineImage | null {
  const images = snapshot?.images ?? []
  const image = images.find((i) => variant && i.variantIds.includes(variant.id)) ?? images[0]
  if (!image) return null
  const { key, contentType, width, height, widths, alt } = image
  return { key, contentType, width, height, widths, alt }
}

/** Published versions of the policy pages linked to the products in the order. */
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
 * Creates the gateway payment link and stores its reference. Call last in the transaction: a gateway error is logged,
 * then 502 rolls the order back. The return URL has no token, so the gateway never sees the view/cancel link.
 * `clientIp` is the raw `req.ip`; normalized here.
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
      // `trust proxy` (app.ts) gives the real IP behind Caddy; strip Node's IPv4-mapped prefix.
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
