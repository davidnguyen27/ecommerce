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
import { hashOpaqueToken } from '../core/auth/opaque-token.ts'
import { authSubject } from '../core/middleware/require-auth.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, invalidField } from '../core/errors.ts'
import { RATE_LIMITS, enforceRateLimits } from '../core/middleware/rate-limit.ts'
import { parse } from '../core/middleware/validation.ts'
import { deleteSupportImageQuietly, receiveSupportImage, storeSupportImage } from '../core/media/support-images.ts'
import { createOrderQuery } from '../modules/order/index.ts'
import {
  SUPPORT_INCLUDE,
  addCustomerMessage,
  createSupportRequest,
  findSupportCustomer,
  recordAttachment,
  toPublicSupport,
  toPublicSupportSummary,
  type NewSupportRequest,
} from '../support/support.ts'
import { exchangeOptions } from '../support/exchanges.ts'

type Deps = Pick<AppDeps, 'prisma' | 'emails' | 'siteUrl' | 'storage' | 'payments'>

/** Which requests the customer may see, and where new requests attach. */
type Scope = {
  where: Prisma.SupportRequestWhereInput
  owner: (input: { orderCode?: number }) => Promise<Pick<NewSupportRequest, 'order' | 'customer'>>
}

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy yêu cầu')

/** Request code from the URL; a non-code string is 404, like a code with no request. */
function parseRequestCode(code: string) {
  if (!/^\d{1,9}$/.test(code)) throw notFound()
  return Number(code)
}

/**
 * Support requests as customers see them (spec M6b). Two paths share one route set, differing only by `scope`: the
 * customer account sees its own requests; an order lookup link holder sees that order's. Others' requests are 404.
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
        await enforceRateLimits(prisma, [{ limit: RATE_LIMITS.supportCreatePerIp, subject: String(req.ip) }])
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
      // Exchangeable variants per order line, for the exchange form. Accounts pick the order with `?orderCode=`.
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
        await enforceRateLimits(prisma, [{ limit: RATE_LIMITS.supportMessagePerRequest, subject: id }])
        const request = await prisma.$transaction((tx) => addCustomerMessage(tx, scoped, message))
        const body: PublicSupportRequest = await toPublicSupport(storage, request)
        res.set('Cache-Control', 'no-store').json(body)
      })
      // Images attach to the customer's message: send the message first, then upload each image to it (spec M6b ticket
      // 02).
      .post('/:requestCode/messages/:messageId/attachments', receiveSupportImage, async (req, res) => {
        const { where } = await scopeOf(req)
        const scoped = { ...where, code: parseRequestCode(String(req.params.requestCode)) }
        const { id } = await view(scoped)
        await enforceRateLimits(prisma, [{ limit: RATE_LIMITS.supportImagePerIp, subject: String(req.ip) }])
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

/** `/api/account/support-requests`: the signed-in customer's requests; may attach to their own orders. */
export function accountSupportRoutes(deps: Deps) {
  return customerSupportRoutes(deps, async (req) => {
    const customerId = authSubject(req)
    return {
      // Including requests sent via a lookup link while the order was a guest order, later linked to the account.
      where: { OR: [{ customerId }, { order: { customerId } }] },
      owner: async ({ orderCode }) => {
        if (orderCode !== undefined) {
          const order = await createOrderQuery(deps).findCustomerOrder(deps.prisma, String(orderCode), customerId)
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
        const customer = await findSupportCustomer(deps.prisma, { id: customerId })
        if (!customer) throw notFound()
        return { customer }
      },
    }
  })
}

/** `/api/orders/:code/support-requests?token=…`: the order's requests, for lookup link holders (like viewing in M3). */
export function orderSupportRoutes(deps: Deps) {
  return customerSupportRoutes(deps, async (req) => {
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const order = await createOrderQuery(deps).findByToken(deps.prisma, String(req.params.code), token)
    const selected = { id: order.id, code: order.code, email: order.email, recipientName: order.recipientName }
    return {
      where: { orderId: order.id },
      owner: async () => ({ order: { ...selected, customerId: order.customerId } }),
    }
  })
}

/**
 * `/api/support-requests?token=…`: requests of guests without an order (chatbot handoff, M8), opened with the emailed
 * token. Each token sees only its own request; no new requests through this path.
 */
export function contactSupportRoutes(deps: Deps) {
  return customerSupportRoutes(deps, async (req) => {
    const token = typeof req.query.token === 'string' ? req.query.token : ''
    if (!token) throw notFound()
    return {
      where: { tokens: { some: { tokenHash: hashOpaqueToken(token) } } },
      owner: async () => {
        throw notFound()
      },
    }
  })
}
