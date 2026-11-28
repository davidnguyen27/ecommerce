import { Router, type RequestHandler } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { ChatbotAdminController, ChatbotController } from './chatbot.controller.ts'

/** Customer chatbot under `/api/chat`; a customer access token on handoff links the request to the account. */
export class ChatRoute implements IRoute {
  readonly path = '/chat'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: ChatbotController, customerSession: RequestHandler) {
    this.router
      .get('/status', c.status)
      .post('/messages', c.message)
      .post('/handoff', customerSession, c.handoff)
      .get('/conversations/:id', c.conversation)
  }
}

/** Admin chatbot pages under `/api/admin/chatbot`: `chatbot.manage`, owner only by default. */
export class ChatbotAdminRoute implements IRoute {
  readonly path = '/chatbot'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: ChatbotAdminController) {
    this.router
      .use(requirePermission('chatbot.manage'))
      .get('/settings', c.settings)
      .put('/settings', c.saveSettings)
      .get('/status', c.status)
      .get('/conversations', c.conversations)
      .get('/conversations/:id', c.conversation)
  }
}

/**
 * Chatbot report (spec M8) under `/api/admin/reports/chatbot`, mounted before the report module: it uses
 * `chatbot.manage` instead of `report.view`, so holders of only `chatbot.manage` can still see it.
 */
export class ChatbotReportRoute implements IRoute {
  readonly path = '/reports/chatbot'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: ChatbotAdminController) {
    this.router.use(requirePermission('chatbot.manage')).get('/', c.report)
  }
}
