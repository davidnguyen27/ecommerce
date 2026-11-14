import type { Db, DbClient } from '../db.ts'
import { Prisma, type PaymentSource, type ReconciliationReason } from '../generated/prisma/client.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { issueOrderLookupUrl, recordOrderEvent } from '../orders/orders.ts'
import type { PaymentGateway } from './gateway.ts'

/** Một khoản tiền cổng báo về, từ callback (nguồn `webhook`), truy vấn hay cổng giả lập. */
export type PaymentReceipt = {
  orderCode: number
  /** VND. */
  amount: number
  /** Mã tham chiếu giao dịch của cổng; cùng một khoản thì cùng mã dù đến từ đường nào. */
  reference: string
  /**
   * Mã đơn bên cổng của link mà khoản này về qua (VNPAY `vnp_TxnRef`); quyết định mục đích của giao dịch. Không có, hay
   * không thấy link của đơn mang mã này (đơn cũ), thì coi là trả đủ.
   */
  gatewayReference?: string
  paidAt: Date
  source: PaymentSource
  /** Dữ liệu gốc, lưu để đối chiếu. */
  payload: Prisma.InputJsonValue
}

/**
 * `paid`: đơn vừa thành đã trả đủ. `flagged`: khoản tiền cần đối soát. `duplicate`: khoản này đã ghi từ trước.
 * `unknown_order`: không có đơn mang mã này.
 */
export type RecordPaymentOutcome = 'paid' | 'flagged' | 'duplicate' | 'unknown_order'

export type RecordPaymentDeps = { prisma: Db; emails: EmailQueue; siteUrl: string }

const VND = new Intl.NumberFormat('vi-VN')
const vnd = (amount: bigint | number) => `${VND.format(amount)} ₫`

/**
 * Hàm duy nhất ghi nhận tiền về cho đơn (ADR 0009), chạy nhiều lần vẫn một kết quả. Khóa đơn `FOR UPDATE` nên callback
 * và truy vấn cùng về thì lần sau thấy giao dịch lần trước đã ghi. Đơn chờ thanh toán mà tổng đã nhận bằng đúng tổng
 * phải trả thì thành đã trả đủ; mọi trường hợp khác gắn cờ cần đối soát, không đổi trạng thái đơn.
 */
export async function recordPayment(deps: RecordPaymentDeps, receipt: PaymentReceipt): Promise<RecordPaymentOutcome> {
  try {
    return await deps.prisma.$transaction((tx) => recordInTransaction(tx, deps, receipt))
  } catch (err) {
    // Cùng mã tham chiếu đang được ghi cho một đơn khác, song song: unique chặn, coi như đã ghi.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'duplicate'
    throw err
  }
}

async function recordInTransaction(
  tx: DbClient,
  { emails, siteUrl }: RecordPaymentDeps,
  receipt: PaymentReceipt,
): Promise<RecordPaymentOutcome> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "order" WHERE "code" = ${receipt.orderCode} FOR UPDATE`
  if (locked.length === 0) return 'unknown_order'
  if (await tx.paymentTransaction.findUnique({ where: { reference: receipt.reference }, select: { id: true } })) {
    return 'duplicate'
  }

  const order = await tx.order.findUniqueOrThrow({
    where: { id: locked[0]!.id },
    include: { lines: { orderBy: { position: 'asc' } } },
  })
  const link = receipt.gatewayReference
    ? await tx.paymentLink.findFirst({
        where: { orderId: order.id, gatewayReference: receipt.gatewayReference },
        select: { purpose: true },
      })
    : null
  const transaction = await tx.paymentTransaction.create({
    data: {
      orderId: order.id,
      purpose: link?.purpose ?? 'full',
      amount: receipt.amount,
      reference: receipt.reference,
      paidAt: receipt.paidAt,
      source: receipt.source,
      payload: receipt.payload,
    },
  })
  // Chỉ khoản trả đủ mới làm đơn hàng sẵn thành đã trả; cọc và phần còn lại có luồng riêng (M4).
  const { _sum } = await tx.paymentTransaction.aggregate({
    where: { orderId: order.id, purpose: 'full' },
    _sum: { amount: true },
  })
  const received = _sum.amount ?? 0n
  const eventData = { amount: receipt.amount, reference: receipt.reference, source: receipt.source }

  if (order.status === 'pending_payment' && received === order.total) {
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'processing', paymentStatus: 'paid', reservedUntil: null },
    })
    // Khoản trước bị gắn lệch tiền mà nay đủ: các mục đó không còn gì để kế toán xử lý.
    const settled = await tx.reconciliationItem.findMany({
      where: { orderId: order.id, status: 'open', reason: 'amount_mismatch' },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })
    const settledReconciliationItemIds = settled.map((item) => item.id)
    await tx.reconciliationItem.updateMany({
      where: { id: { in: settledReconciliationItemIds } },
      data: { status: 'resolved', resolution: 'settled_by_payment', resolvedAt: new Date() },
    })
    await recordOrderEvent(
      tx,
      order.id,
      'paid',
      { type: 'system' },
      settledReconciliationItemIds.length ? { ...eventData, settledReconciliationItemIds } : eventData,
    )
    await queuePaymentReceivedEmail(tx, { emails, siteUrl }, order)
    return 'paid'
  }

  const reason: ReconciliationReason =
    order.status === 'cancelled'
      ? 'paid_after_cancel'
      : order.paymentStatus === 'paid'
        ? 'extra_payment'
        : 'amount_mismatch'
  await tx.reconciliationItem.create({
    data: {
      orderId: order.id,
      transactionId: transaction.id,
      reason,
      amount: receipt.amount,
      receivedAt: receipt.paidAt,
    },
  })
  await recordOrderEvent(tx, order.id, 'payment_flagged', { type: 'system' }, { ...eventData, reason })
  return 'flagged'
}

/**
 * Hỏi cổng các khoản đã về qua mọi link của đơn, cũ trước, và ghi nhận từng khoản (nguồn `query`), phòng khi callback
 * tới chậm hoặc không tới. Đơn chưa có link thì không hỏi. Cổng lỗi thì ném; nơi gọi quyết định log rồi đi tiếp.
 */
export async function recordGatewayPayments(
  deps: RecordPaymentDeps & { payments: PaymentGateway },
  order: { code: number },
) {
  const links = await deps.prisma.paymentLink.findMany({
    where: { order: { code: order.code } },
    select: { gatewayReference: true },
    orderBy: { createdAt: 'asc' },
  })
  for (const { gatewayReference } of links) {
    const info = await deps.payments.getPayment(gatewayReference)
    for (const t of info.transactions) {
      await recordPayment(deps, {
        orderCode: order.code,
        amount: t.amount,
        reference: t.reference,
        gatewayReference,
        paidAt: t.paidAt,
        source: 'query',
        payload: t.payload ?? { reference: t.reference, amount: t.amount, paidAt: t.paidAt.toISOString() },
      })
    }
  }
}

/** Mã đơn bên cổng của mọi link của đơn, cũ trước: để hủy link khi hủy đơn. */
export const PAYMENT_LINK_REFERENCES = {
  select: { gatewayReference: true },
  orderBy: { createdAt: 'asc' },
} as const satisfies Prisma.Order$paymentLinksArgs

type OrderWithLines = Prisma.OrderGetPayload<{ include: { lines: true } }>

/**
 * Xếp email "đã nhận thanh toán" (tóm tắt đơn, tổng tiền, link tra cứu có token mới) trong transaction của thay đổi
 * trạng thái. Dùng chung cho thanh toán bình thường và khôi phục đơn khi đối soát. `order.lines` xếp theo `position`.
 */
export async function queuePaymentReceivedEmail(
  tx: DbClient,
  { emails, siteUrl }: Pick<RecordPaymentDeps, 'emails' | 'siteUrl'>,
  order: OrderWithLines,
) {
  const link = await issueOrderLookupUrl(tx, siteUrl, order)
  const lines = order.lines.map((line) => {
    const attributes = Object.values(line.attributes as Record<string, unknown>)
      .map((v) => (Array.isArray(v) ? v.join(', ') : String(v)))
      .join(' · ')
    const name = attributes ? `${line.productName} (${attributes})` : line.productName
    return `- ${name} x ${line.quantity}: ${vnd(line.price * BigInt(line.quantity))}`
  })
  // Bản nháp, chờ chủ doanh nghiệp duyệt nội dung.
  await emails.sendEmail(tx, {
    to: order.email,
    subject: `Đã nhận thanh toán đơn hàng #${order.code}`,
    text: [
      `Chào ${order.recipientName},`,
      '',
      `Chúng tôi đã nhận đủ thanh toán cho đơn hàng #${order.code}.`,
      '',
      ...lines,
      `Phí giao: ${vnd(order.shippingFee)}`,
      `Tổng cộng: ${vnd(order.total)}`,
      '',
      `Xem đơn hàng: ${link}`,
      '',
      'Chúng tôi sẽ báo cho bạn khi đơn được giao cho đơn vị vận chuyển.',
    ].join('\n'),
  })
}
