import { Router, type Request } from 'express'
import {
  CreateSupportRequest,
  ErrorCode,
  SupportMessageRequest,
  type ExchangeOptions,
  type PublicSupportList,
  type PublicSupportRequest,
} from '@ecommerce/shared'
import type { AppDeps } from '../app.ts'
import { authSubject } from '../auth/require-auth.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../http/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../http/rate-limit.ts'
import { parse } from '../http/validation.ts'
import { deleteSupportImageQuietly, receiveSupportImage, storeSupportImage } from '../media/support-images.ts'
import { findCustomerOrder, findOrderByToken } from '../orders/orders.ts'
import {
  SUPPORT_INCLUDE,
  addCustomerMessage,
  createSupportRequest,
  recordAttachment,
  toPublicSupport,
  toPublicSupportSummary,
  type NewSupportRequest,
} from '../support/support.ts'
import { exchangeOptions } from '../support/exchanges.ts'

type Deps = Pick<AppDeps, 'prisma' | 'emails' | 'siteUrl' | 'storage'>

/** Khách được xem những yêu cầu nào, và yêu cầu mới gắn vào đâu. */
type Scope = {
  where: Prisma.SupportRequestWhereInput
  owner: (input: { orderCode?: number }) => Promise<Pick<NewSupportRequest, 'order' | 'customer'>>
}

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy yêu cầu')

/** Mã yêu cầu từ URL; chuỗi không phải mã là 404, như mã không có yêu cầu nào. */
function parseRequestCode(code: string) {
  if (!/^\d{1,9}$/.test(code)) throw notFound()
  return Number(code)
}

/**
 * Yêu cầu hỗ trợ như khách thấy (spec M6b). Hai đường dùng chung một bộ route, chỉ khác `scope`: tài khoản khách thấy
 * yêu cầu của mình; người cầm link tra cứu đơn thấy yêu cầu của đơn đó. Yêu cầu của người khác là 404 như mã lạ.
 */
function customerSupportRoutes({ prisma, emails, siteUrl, storage }: Deps, scopeOf: (req: Request) => Promise<Scope>) {
  const mail = { emails, siteUrl }
  const view = async (where: Prisma.SupportRequestWhereInput) => {
    const request = await prisma.supportRequest.findFirst({ where, include: SUPPORT_INCLUDE })
    if (!request) throw notFound()
    return request
  }
  return (
    Router({ mergeParams: true })
      .get('/', async (req, res) => {
        const { where } = await scopeOf(req)
        const requests = await prisma.supportRequest.findMany({
          where,
          include: SUPPORT_INCLUDE,
          orderBy: [{ createdAt: 'desc' }, { code: 'desc' }],
          take: 100,
        })
        const body: PublicSupportList = { items: requests.map(toPublicSupportSummary) }
        res.set('Cache-Control', 'no-store').json(body)
      })
      .post('/', async (req, res) => {
        const input = parse(CreateSupportRequest, req.body)
        const scope = await scopeOf(req)
        await enforceRateLimits(prisma, res, [{ limit: RATE_LIMITS.supportCreatePerIp, subject: String(req.ip) }])
        const owner = await scope.owner({ orderCode: input.orderCode })
        const request = await prisma.$transaction((tx) =>
          createSupportRequest(tx, mail, {
            kind: input.kind,
            subject: input.subject,
            message: input.message,
            previousRequestCode: input.previousRequestCode,
            lines: 'lines' in input ? input.lines : undefined,
            creator: { type: 'customer' },
            ...owner,
          }),
        )
        const body: PublicSupportRequest = await toPublicSupport(storage, request)
        res.status(201).set('Cache-Control', 'no-store').json(body)
      })
      // Biến thể đổi được của từng dòng đơn, cho form đổi hàng. Tài khoản khách chọn đơn bằng `?orderCode=`.
      .get('/exchange-options', async (req, res) => {
        const scope = await scopeOf(req)
        const orderCode =
          typeof req.query.orderCode === 'string' && /^\d{1,9}$/.test(req.query.orderCode)
            ? Number(req.query.orderCode)
            : undefined
        const { order } = await scope.owner({ orderCode })
        if (!order) throw invalidField('orderCode', 'Cần mã đơn')
        const body: ExchangeOptions = await exchangeOptions(prisma, order.id)
        res.set('Cache-Control', 'no-store').json(body)
      })
      .get('/:requestCode', async (req, res) => {
        const { where } = await scopeOf(req)
        const request = await view({ ...where, code: parseRequestCode(String(req.params.requestCode)) })
        const body: PublicSupportRequest = await toPublicSupport(storage, request)
        res.set('Cache-Control', 'no-store').json(body)
      })
      .post('/:requestCode/messages', async (req, res) => {
        const { message } = parse(SupportMessageRequest, req.body)
        const { where } = await scopeOf(req)
        const scoped = { ...where, code: parseRequestCode(String(req.params.requestCode)) }
        const { id } = await view(scoped)
        await enforceRateLimits(prisma, res, [{ limit: RATE_LIMITS.supportMessagePerRequest, subject: id }])
        const request = await prisma.$transaction((tx) => addCustomerMessage(tx, scoped, message))
        const body: PublicSupportRequest = await toPublicSupport(storage, request)
        res.set('Cache-Control', 'no-store').json(body)
      })
      // Ảnh gắn vào tin của khách: gửi tin trước, rồi tải từng ảnh vào tin đó (spec M6b ticket 02).
      .post('/:requestCode/messages/:messageId/attachments', receiveSupportImage, async (req, res) => {
        const { where } = await scopeOf(req)
        const scoped = { ...where, code: parseRequestCode(String(req.params.requestCode)) }
        const { id } = await view(scoped)
        await enforceRateLimits(prisma, res, [{ limit: RATE_LIMITS.supportImagePerIp, subject: String(req.ip) }])
        const image = await storeSupportImage(storage, req, id)
        try {
          await prisma.$transaction((tx) =>
            recordAttachment(tx, scoped, String(req.params.messageId), { type: 'customer' }, image),
          )
        } catch (err) {
          await deleteSupportImageQuietly(storage, req, image.key)
          throw err
        }
        const body: PublicSupportRequest = await toPublicSupport(storage, await view(scoped))
        res.status(201).set('Cache-Control', 'no-store').json(body)
      })
  )
}

/** `/api/account/support-requests`: yêu cầu của khách đang đăng nhập; gắn được vào đơn của chính khách. */
export function accountSupportRoutes(deps: Deps) {
  return customerSupportRoutes(deps, async (req) => {
    const customerId = authSubject(req)
    return {
      // Kể cả yêu cầu gửi qua link tra cứu khi đơn còn vãng lai, sau đó đơn mới gắn vào tài khoản.
      where: { OR: [{ customerId }, { order: { customerId } }] },
      owner: async ({ orderCode }) => {
        if (orderCode !== undefined) {
          const order = await findCustomerOrder(deps.prisma, String(orderCode), customerId)
          return {
            order: {
              id: order.id,
              code: order.code,
              email: order.email,
              recipientName: order.recipientName,
              customerId: order.customerId,
            },
          }
        }
        const customer = await deps.prisma.customer.findUniqueOrThrow({
          where: { id: customerId },
          select: { id: true, email: true },
        })
        return { customer }
      },
    }
  })
}

/** `/api/orders/:code/support-requests?token=…`: yêu cầu của đơn, cho người cầm link tra cứu (như xem đơn ở M3). */
export function orderSupportRoutes(deps: Deps) {
  return customerSupportRoutes(deps, async (req) => {
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const order = await findOrderByToken(deps.prisma, String(req.params.code), token)
    const selected = { id: order.id, code: order.code, email: order.email, recipientName: order.recipientName }
    return {
      where: { orderId: order.id },
      owner: async () => ({ order: { ...selected, customerId: order.customerId } }),
    }
  })
}
