import {
  ErrorCode,
  type CreateSupportRequest,
  type ExchangeOptions,
  type PublicSupportList,
  type PublicSupportRequest,
} from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { Storage } from '../../core/adapters/storage.ts'
import { hashOpaqueToken } from '../../core/auth/opaque-token.ts'
import type { Db } from '../../core/db.ts'
import { AppError, invalidField } from '../../core/errors.ts'
import type { CustomerMail } from '../../core/jobs/queues.ts'
import { RATE_LIMITS, enforceRateLimits } from '../../core/middleware/rate-limit.ts'
import { deleteSupportImageQuietly, storeSupportImage } from '../../core/media/support-images.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import type { IOrderQuery } from '../order/index.ts'
import { exchangeOptions } from './support-exchange.ts'
import {
  addCustomerMessage,
  createSupportRequest,
  findSupportCustomer,
  recordAttachment,
  toPublicSupport,
  toPublicSupportSummary,
  type NewSupportRequest,
} from './support-request.ts'
import type { SupportRepository } from './support.repository.ts'

const notFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy yêu cầu')

/** Request code from the URL; a non-code string is 404, like a code with no request. */
function parseRequestCode(code: string) {
  if (!/^\d{1,9}$/.test(code)) throw notFound()
  return Number(code)
}

/**
 * Who is looking: the signed-in customer, an order lookup link holder, or a guest with the emailed contact token (a
 * chatbot handoff without an order, M8).
 */
export type SupportViewer =
  | { kind: 'account'; customerId: string }
  | { kind: 'order'; orderCode: string; token: string | undefined }
  | { kind: 'contact'; token: string }

/** Which requests the viewer may see, and where new requests attach. */
type Scope = {
  where: Prisma.SupportRequestWhereInput
  owner: (input: { orderCode?: number }) => Promise<Pick<NewSupportRequest, 'order' | 'customer'>>
}

/**
 * Support requests as customers see them (spec M6b). Every viewer runs the same actions, differing only by scope;
 * others' requests are 404.
 */
export class SupportCustomerService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: SupportRepository,
    private readonly storage: Storage,
    private readonly mail: CustomerMail,
    private readonly orders: Pick<IOrderQuery, 'findByToken' | 'findCustomerOrder'>,
  ) {}

  private async scope(viewer: SupportViewer): Promise<Scope> {
    const { prisma } = this
    switch (viewer.kind) {
      case 'account': {
        const { customerId } = viewer
        return {
          // Including requests sent via a lookup link while the order was a guest order, later linked to the account.
          where: { OR: [{ customerId }, { order: { customerId } }] },
          owner: async ({ orderCode }) => {
            if (orderCode !== undefined) {
              const order = await this.orders.findCustomerOrder(prisma, String(orderCode), customerId)
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
            const customer = await findSupportCustomer(prisma, { id: customerId })
            if (!customer) throw notFound()
            return { customer }
          },
        }
      }
      case 'order': {
        const order = await this.orders.findByToken(prisma, viewer.orderCode, viewer.token)
        const selected = { id: order.id, code: order.code, email: order.email, recipientName: order.recipientName }
        return {
          where: { orderId: order.id },
          owner: async () => ({ order: { ...selected, customerId: order.customerId } }),
        }
      }
      case 'contact':
        // Each token sees only its own request; no new requests through this path.
        if (!viewer.token) throw notFound()
        return {
          where: { tokens: { some: { tokenHash: hashOpaqueToken(viewer.token) } } },
          owner: async () => {
            throw notFound()
          },
        }
    }
  }

  private async view(where: Prisma.SupportRequestWhereInput) {
    const request = await this.repo.findFirst(this.prisma, where)
    if (!request) throw notFound()
    return request
  }

  /** The viewer's scope narrowed to one request; the scope is checked before the code, as a 404 for the scope wins. */
  private async scoped(viewer: SupportViewer, rawCode: string) {
    const { where } = await this.scope(viewer)
    return { ...where, code: parseRequestCode(rawCode) }
  }

  async list(viewer: SupportViewer): Promise<PublicSupportList> {
    const { where } = await this.scope(viewer)
    return { items: (await this.repo.customerList(this.prisma, where)).map(toPublicSupportSummary) }
  }

  async create(viewer: SupportViewer, input: CreateSupportRequest, clientIp: string): Promise<PublicSupportRequest> {
    const scope = await this.scope(viewer)
    await enforceRateLimits(this.prisma, [{ limit: RATE_LIMITS.supportCreatePerIp, subject: clientIp }])
    const owner = await scope.owner({ orderCode: input.orderCode })
    const request = await this.prisma.$transaction((tx) =>
      createSupportRequest(tx, this.mail, {
        kind: input.kind,
        subject: input.subject,
        message: input.message,
        previousRequestCode: input.previousRequestCode,
        lines: 'lines' in input ? input.lines : undefined,
        creator: { type: 'customer' },
        ...owner,
      }),
    )
    return toPublicSupport(this.storage, request)
  }

  /** Exchangeable variants per order line, for the exchange form. Accounts pick the order with `orderCode`. */
  async exchangeOptions(viewer: SupportViewer, orderCode: number | undefined): Promise<ExchangeOptions> {
    const { order } = await (await this.scope(viewer)).owner({ orderCode })
    if (!order) throw invalidField('orderCode', 'Cần mã đơn')
    return exchangeOptions(this.prisma, order.id)
  }

  async detail(viewer: SupportViewer, rawCode: string): Promise<PublicSupportRequest> {
    return toPublicSupport(this.storage, await this.view(await this.scoped(viewer, rawCode)))
  }

  async addMessage(viewer: SupportViewer, rawCode: string, message: string): Promise<PublicSupportRequest> {
    const scoped = await this.scoped(viewer, rawCode)
    const { id } = await this.view(scoped)
    await enforceRateLimits(this.prisma, [{ limit: RATE_LIMITS.supportMessagePerRequest, subject: id }])
    const request = await this.prisma.$transaction((tx) => addCustomerMessage(tx, scoped, message))
    return toPublicSupport(this.storage, request)
  }

  /**
   * Attaches an image to the customer's message: the message is sent first, then each image uploaded to it (spec M6b
   * ticket 02). The stored file is deleted if recording fails.
   */
  async attach(
    viewer: SupportViewer,
    rawCode: string,
    messageId: string,
    file: Express.Multer.File | undefined,
    clientIp: string,
    log: Logger,
  ): Promise<PublicSupportRequest> {
    const scoped = await this.scoped(viewer, rawCode)
    const { id } = await this.view(scoped)
    await enforceRateLimits(this.prisma, [{ limit: RATE_LIMITS.supportImagePerIp, subject: clientIp }])
    const image = await storeSupportImage(this.storage, file, id)
    try {
      await this.prisma.$transaction((tx) => recordAttachment(tx, scoped, messageId, { type: 'customer' }, image))
    } catch (err) {
      await deleteSupportImageQuietly(this.storage, log, image.key)
      throw err
    }
    return toPublicSupport(this.storage, await this.view(scoped))
  }
}
