import type { SupportRequestKind } from '@ecommerce/shared'
import { hashOpaqueToken, newOpaqueToken } from '../auth/opaque-token.ts'
import type { DbClient } from '../db.ts'
import type { CustomerMail } from '../jobs/jobs.ts'
import { EXCHANGE_SEND_DAYS } from './exchanges.ts'
import type { SupportForView } from './support.ts'

/**
 * Email cho khách về yêu cầu hỗ trợ (spec M6b), theo từng lúc và từng loại yêu cầu. Nội dung chủ doanh nghiệp giao cho
 * cửa hàng soạn (2026-11-18). Cửa hàng chịu phí gửi hàng trả, đổi và bảo hành.
 */

/** Lúc gửi email: tạo yêu cầu, nhân viên trả lời, chấp nhận, xong, từ chối. */
export type SupportEmail = 'created' | 'reply' | 'accepted' | 'resolved' | 'rejected'

const KIND_TEXT: Record<SupportRequestKind, string> = {
  cancel: 'hủy đơn',
  return: 'trả hàng',
  exchange: 'đổi hàng',
  warranty: 'bảo hành',
  other: 'hỗ trợ',
}

export const SHIPPING_COVERED =
  'Cửa hàng chịu toàn bộ phí gửi hàng khi trả, đổi và bảo hành: bạn không phải trả tiền cho đơn vị vận chuyển.'

const sendsGoods = (kind: SupportRequestKind) => kind === 'return' || kind === 'exchange' || kind === 'warranty'

/** Danh sách sản phẩm của yêu cầu, mỗi dòng một sản phẩm; đổi hàng ghi kèm biến thể đổi sang. */
function linesText(request: SupportForView) {
  return request.lines.map(
    (l) =>
      `- ${l.orderLine.productName} (${l.heldVariant.sku}) × ${l.quantity}` +
      (l.exchangeVariant ? ` → đổi sang ${l.exchangeVariant.sku}` : ''),
  )
}

function createdText(request: SupportForView): string[] {
  const order = request.order ? ` của đơn hàng #${request.order.code}` : ''
  switch (request.kind) {
    case 'cancel':
      return [
        `Cửa hàng đã nhận yêu cầu hủy đơn hàng #${request.order!.code}.`,
        'Nếu đơn chưa được giao cho đơn vị vận chuyển, cửa hàng sẽ hủy đơn và gửi bạn email báo số tiền hoàn.',
      ]
    case 'return':
    case 'exchange':
    case 'warranty':
      return [
        `Cửa hàng đã nhận yêu cầu ${KIND_TEXT[request.kind]}${order}:`,
        ...linesText(request),
        '',
        request.kind === 'warranty'
          ? 'Cửa hàng sẽ kiểm tra thông tin bảo hành của sản phẩm và gửi bạn hướng dẫn gửi sản phẩm.'
          : 'Bạn chưa cần gửi hàng: cửa hàng sẽ kiểm tra và gửi hướng dẫn trong email tiếp theo.',
        SHIPPING_COVERED,
      ]
    case 'other':
      return ['Cửa hàng đã nhận yêu cầu của bạn và sẽ trả lời sớm trong giờ làm việc.']
  }
}

function acceptedText(request: SupportForView, message: string): string[] {
  const afterReceive = {
    return: 'Sau khi nhận và kiểm tra hàng, cửa hàng sẽ báo bạn số tiền hoàn.',
    exchange: `Sản phẩm mới đã được giữ riêng cho bạn. Cửa hàng gửi sản phẩm mới ngay khi nhận được hàng bạn gửi về; bạn vui lòng gửi hàng trong vòng ${EXCHANGE_SEND_DAYS} ngày.`,
    warranty: 'Cửa hàng sẽ báo bạn từng bước: đã nhận sản phẩm, đã gửi đi bảo hành, đã gửi trả lại bạn.',
  }
  return [
    `Cửa hàng đã chấp nhận yêu cầu ${KIND_TEXT[request.kind]} của bạn.`,
    '',
    'Hướng dẫn gửi hàng:',
    message,
    '',
    `Khi đóng gói, bạn ghi mã yêu cầu #YC${request.code} bên ngoài gói hàng để cửa hàng nhận đúng.`,
    SHIPPING_COVERED,
    ...(request.kind in afterReceive ? [afterReceive[request.kind as keyof typeof afterReceive]] : []),
  ]
}

function resolvedText(request: SupportForView, message?: string): string[] {
  const head = {
    cancel: 'Yêu cầu hủy đơn của bạn đã được xử lý xong.',
    return: 'Yêu cầu trả hàng của bạn đã được xử lý xong.',
    exchange: 'Cửa hàng đã gửi sản phẩm đổi cho bạn.',
    warranty: 'Yêu cầu bảo hành của bạn đã có kết quả.',
    other: 'Yêu cầu của bạn đã được xử lý xong.',
  }[request.kind]
  return [head, ...(message ? ['', message] : [])]
}

function rejectedText(request: SupportForView, message?: string): string[] {
  const head = `Rất tiếc, cửa hàng không thể chấp nhận yêu cầu ${KIND_TEXT[request.kind]} của bạn.`
  return message ? [head, '', 'Lý do:', message] : [head, 'Bạn xem trao đổi trong trang yêu cầu để biết lý do.']
}

/** Link trang yêu cầu: trang tài khoản nếu yêu cầu thuộc tài khoản, không thì link tra cứu đơn kèm token mới. */
async function requestUrl(tx: DbClient, siteUrl: string, request: SupportForView) {
  if (request.customerId) return new URL(`/tai-khoan/yeu-cau/${request.code}`, siteUrl).toString()
  const token = newOpaqueToken()
  await tx.orderLookupToken.create({ data: { orderId: request.orderId!, tokenHash: hashOpaqueToken(token) } })
  const url = new URL(`/yeu-cau/${request.code}`, siteUrl)
  url.searchParams.set('don', String(request.order!.code))
  url.searchParams.set('token', token)
  return url.toString()
}

/**
 * Xếp email cho khách trong transaction của thay đổi; `message` là lời của nhân viên kèm theo (trả lời, hướng dẫn gửi
 * hàng, lý do từ chối, số tiền hoàn, mã vận đơn).
 */
export async function queueSupportEmail(
  tx: DbClient,
  { emails, siteUrl }: CustomerMail,
  request: SupportForView,
  event: SupportEmail,
  message?: string,
) {
  const link = await requestUrl(tx, siteUrl, request)
  const title = `#YC${request.code} ${request.subject}`
  const subjects: Record<SupportEmail, string> = {
    created: `Đã nhận yêu cầu ${title}`,
    reply: `Cửa hàng đã trả lời yêu cầu ${title}`,
    accepted: `Yêu cầu ${title} đã được chấp nhận`,
    resolved: `Yêu cầu ${title} đã được xử lý xong`,
    rejected: `Yêu cầu ${title} không được chấp nhận`,
  }
  const closingLine =
    request.status === 'resolved'
      ? 'Yêu cầu đã được xử lý xong.'
      : request.status === 'rejected'
        ? 'Yêu cầu đã được đóng.'
        : null
  const body: Record<SupportEmail, () => string[]> = {
    created: () => createdText(request),
    reply: () => [
      'Cửa hàng vừa trả lời yêu cầu của bạn:',
      '',
      message ?? '',
      ...(closingLine ? ['', closingLine] : []),
    ],
    accepted: () => (sendsGoods(request.kind) ? acceptedText(request, message ?? '') : resolvedText(request, message)),
    resolved: () => resolvedText(request, message),
    rejected: () => rejectedText(request, message),
  }
  await emails.sendEmail(tx, {
    to: request.contactEmail,
    subject: subjects[event],
    text: [
      `Chào ${request.contactName ?? 'bạn'},`,
      '',
      ...body[event](),
      '',
      `Xem và trả lời yêu cầu: ${link}`,
      'Nếu cần trao đổi thêm, bạn trả lời ngay trên trang yêu cầu để nhân viên phụ trách thấy.',
    ].join('\n'),
  })
}
