import type { AppDeps } from '../../app.ts'
import { optionalAuth } from '../../core/middleware/require-auth.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { IProductQuery } from '../product/index.ts'
import { ChatbotAdminService } from './chatbot-admin.service.ts'
import { ChatbotAdminController, ChatbotController } from './chatbot.controller.ts'
import { ChatbotRepository } from './chatbot.repository.ts'
import { ChatRoute, ChatbotAdminRoute, ChatbotReportRoute } from './chatbot.route.ts'
import { ChatbotService } from './chatbot.service.ts'

/**
 * Wires repository → services → controllers → routes. The viewed product comes from the product module's query; the
 * model's tools still read products through `createProductQuery` (`chatbot-tools.ts`).
 */
export class ChatbotModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(
    deps: Pick<AppDeps, 'prisma' | 'logger' | 'storage' | 'emails' | 'siteUrl' | 'jwtSecret' | 'llm'>,
    products: Pick<IProductQuery, 'findPublicProduct'>,
  ) {
    super()
    const { prisma, llm } = deps
    const repo = new ChatbotRepository()
    const mail = { emails: deps.emails, siteUrl: deps.siteUrl }
    const customer = new ChatbotService(prisma, repo, deps.storage, llm, mail, deps.logger, products)
    const admin = new ChatbotAdminController(new ChatbotAdminService(prisma, repo, llm))
    const customerSession = optionalAuth(new TextEncoder().encode(deps.jwtSecret), 'customer')
    this.routes = [
      new ChatRoute(new ChatbotController(customer), customerSession),
      new ChatbotAdminRoute(admin),
      new ChatbotReportRoute(admin),
    ]
  }
}
