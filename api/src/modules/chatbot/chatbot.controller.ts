import type { Request, Response } from 'express'
import type {
  AdminChatConversation,
  AdminChatConversationPage,
  ChatConversationView,
  ChatHandoffResponse,
  ChatStatus,
  ChatTurnResponse,
  ChatbotModelStatus,
  ChatbotReport,
  ChatbotSettings,
} from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import { periodOf } from '../report/index.ts'
import type { ChatbotAdminService } from './chatbot-admin.service.ts'
import type { ChatbotService } from './chatbot.service.ts'
import {
  AdminChatConversationQueryDto,
  ChatHandoffDto,
  ChatMessageDto,
  ChatbotReportQueryDto,
  ChatbotSettingsDto,
} from './dto/index.ts'

/** Customer chat handlers. */
export class ChatbotController {
  constructor(private readonly service: ChatbotService) {}

  status = async (_req: Request, res: Response) => {
    const body: ChatStatus = await this.service.status()
    res.json(body)
  }

  message = async (req: Request, res: Response) => {
    const body: ChatTurnResponse = await this.service.message(parse(ChatMessageDto, req.body), req.ip ?? 'unknown')
    res.json(body)
  }

  handoff = async (req: Request, res: Response) => {
    const input = parse(ChatHandoffDto, req.body)
    const body: ChatHandoffResponse = await this.service.handoff(
      input,
      req.auth?.subjectId ?? null,
      req.ip ?? 'unknown',
    )
    res.status(201).json(body)
  }

  conversation = async (req: Request, res: Response) => {
    const body: ChatConversationView = await this.service.conversation(String(req.params.id))
    res.json(body)
  }
}

/** Admin chatbot handlers. */
export class ChatbotAdminController {
  constructor(private readonly service: ChatbotAdminService) {}

  settings = async (_req: Request, res: Response) => {
    const body: ChatbotSettings = await this.service.settings()
    res.json(body)
  }

  saveSettings = async (req: Request, res: Response) => {
    const body: ChatbotSettings = await this.service.saveSettings(parse(ChatbotSettingsDto, req.body), contextOf(req))
    res.json(body)
  }

  status = (_req: Request, res: Response) => {
    const body: ChatbotModelStatus = this.service.status()
    res.json(body)
  }

  conversations = async (req: Request, res: Response) => {
    const query = parse(AdminChatConversationQueryDto, req.query)
    const body: AdminChatConversationPage = await this.service.conversations(query)
    res.json(body)
  }

  conversation = async (req: Request, res: Response) => {
    const body: AdminChatConversation = await this.service.conversation(String(req.params.id))
    res.json(body)
  }

  report = async (req: Request, res: Response) => {
    const body: ChatbotReport = await this.service.report(periodOf(parse(ChatbotReportQueryDto, req.query)))
    res.json(body)
  }
}
