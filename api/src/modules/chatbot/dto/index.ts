// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  AdminChatConversationQuery as AdminChatConversationQueryDto,
  ChatHandoffRequest as ChatHandoffDto,
  ChatMessageRequest as ChatMessageDto,
  ChatbotSettings as ChatbotSettingsDto,
  ReportQuery as ChatbotReportQueryDto,
} from '@ecommerce/shared'
