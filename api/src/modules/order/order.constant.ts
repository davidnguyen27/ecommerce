import { ErrorCode } from '@ecommerce/shared'
import { AppError } from '../../core/errors.ts'
import type { Prisma } from '../../generated/prisma/client.ts'

/** Enough to build a `PublicOrder`. */
export const ORDER_VIEW_INCLUDE = {
  lines: { orderBy: { position: 'asc' } },
  policyVersions: { include: { pageVersion: { include: { page: { select: { slug: true } } } } } },
  privacyPolicyVersion: { select: { version: true } },
  // The campaign's current expected delivery, next to the promise made at order time (ticket 09).
  preorderCampaign: { select: { deliveryFrom: true, deliveryTo: true } },
  // Received amount and the refunds customers see (ADR 0014).
  paymentTransactions: { select: { amount: true } },
  refunds: {
    select: { amount: true, status: true, createdAt: true, completedAt: true },
    orderBy: { createdAt: 'asc' },
  },
} as const satisfies Prisma.OrderInclude

export type OrderForView = Prisma.OrderGetPayload<{ include: typeof ORDER_VIEW_INCLUDE }>

/** Deposited pre-orders not fully paid: waiting for stock or for the remaining balance. */
export const DEPOSITED_PREORDER = {
  kind: 'preorder',
  status: 'processing',
  paymentStatus: 'deposit_paid',
} as const satisfies Prisma.OrderWhereInput

export const orderNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy đơn hàng')

/** Order code from the URL as a number; a non-code string is 404, like a code with no order. */
export function parseOrderCode(code: string) {
  if (!/^\d{1,9}$/.test(code)) throw orderNotFound()
  return Number(code)
}

/** A pre-order's remaining balance: total minus deposit, shipping included (GLOSSARY "Phần còn lại"). */
export const remainingOf = (order: { total: bigint; depositAmount: bigint | null }) =>
  order.total - order.depositAmount!

/** Website order lookup link, emailed to the customer. */
export function orderLookupUrl(siteUrl: string, code: number, token: string) {
  const url = new URL(`/don-hang/${code}`, siteUrl)
  url.searchParams.set('token', token)
  return url
}

/**
 * The payment result page the gateway sends customers back to. No token: the gateway must not see the view/cancel link;
 * the browser keeps the token from the checkout response.
 */
export function paymentResultUrl(siteUrl: string, code: number) {
  const url = new URL(`/don-hang/${code}`, siteUrl)
  url.searchParams.set('ket-qua', '1')
  return url
}
