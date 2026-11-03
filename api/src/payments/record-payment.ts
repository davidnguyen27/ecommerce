import type { Db, DbClient } from '../db.ts'
import { Prisma, type PaymentSource, type ReconciliationReason } from '../generated/prisma/client.ts'
import type { EmailQueue } from '../jobs/jobs.ts'
import { issueOrderLookupUrl, recordOrderEvent } from '../orders/orders.ts'

/** Một khoản tiền cổng báo về, từ webhook, truy vấn hay cổng giả lập. */
export type PaymentReceipt = {
  orderCode: number
  /** VND. */
  amount: number
  /** Mã tham chiếu giao dịch của cổng; cùng một khoản thì cùng mã dù đến từ đường nào. */
  reference: string
  paidAt: Date
  source: PaymentSource
  /** Dữ liệu gốc, lưu để đối chiếu. */
  payload: Prisma.InputJsonValue
}

/**
 * `paid`: đơn vừa thành đã trả đủ. `flagged`: khoản tiền cần đối soát. `duplicate`: khoản này đã ghi từ trước.
 * `unknown_order`: không có đơn mang mã này (ví dụ webhook thử của PayOS).
 */
export type RecordPaymentOutcome = 'paid' | 'flagged' | 'duplicate' | 'unknown_order'

export type RecordPaymentDeps = { prisma: Db; emails: EmailQueue; siteUrl: string }

const VND = new Intl.NumberFormat('vi-VN')
const vnd = (amount: bigint | number) => `${VND.format(amount)} ₫`

/**
 * Hàm duy nhất ghi nhận tiền về cho đơn (ADR 0008), chạy nhiều lần vẫn một kết quả. Khóa đơn `FOR UPDATE` nên webhook
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
  const transaction = await tx.paymentTransaction.create({
    data: {
      orderId: order.id,
      amount: receipt.amount,
      reference: receipt.reference,
      paidAt: receipt.paidAt,
      source: receipt.source,
      payload: receipt.payload,
    },
  })
  const { _sum } = await tx.paymentTransaction.aggregate({ where: { orderId: order.id }, _sum: { amount: true } })
  const received = _sum.amount ?? 0n
  const eventData = { amount: receipt.amount, reference: receipt.reference, source: receipt.source }

  if (order.status === 'pending_payment' && received === order.total) {
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'processing', paymentStatus: 'paid', reservedUntil: null },
    })
    await recordOrderEvent(tx, order.id, 'paid', { type: 'system' }, eventData)
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
