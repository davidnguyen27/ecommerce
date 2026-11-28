import type { AppDeps } from '../../app.ts'
import { optionalAuth } from '../../core/middleware/require-auth.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
import type { ToolDeps } from './chatbot-tools.ts'
import { ChatbotAdminService } from './chatbot-admin.service.ts'
import { ChatbotAdminController, ChatbotController } from './chatbot.controller.ts'
import { ChatbotRepository } from './chatbot.repository.ts'
import { ChatRoute, ChatbotAdminRoute, ChatbotReportRoute } from './chatbot.route.ts'
import { ChatbotService } from './chatbot.service.ts'

/**
 * Wires repository → services → controllers → routes. The model's tools and the viewed product read through the
 * product and attribute schema modules' queries.
 */
export class ChatbotModule extends BaseModule {
  readonly routes: readonly IRoute[]

  constructor(
    deps: Pick<AppDeps, 'prisma' | 'logger' | 'emails' | 'siteUrl' | 'jwtSecret' | 'llm'>,
    reads: Omit<ToolDeps, 'prisma'>,
  ) {
    super()
    const { prisma, llm } = deps
    const repo = new ChatbotRepository()
    const mail = { emails: deps.emails, siteUrl: deps.siteUrl }
    const customer = new ChatbotService(prisma, repo, llm, mail, deps.logger, reads)
    const admin = new ChatbotAdminController(new ChatbotAdminService(prisma, repo, llm))
    const customerSession = optionalAuth(new TextEncoder().encode(deps.jwtSecret), 'customer')
    this.routes = [
      new ChatRoute(new ChatbotController(customer), customerSession),
      new ChatbotAdminRoute(admin),
      new ChatbotReportRoute(admin),
    ]
  }
}
