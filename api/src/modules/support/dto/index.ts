// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  AdminCreateSupportRequest as AdminCreateSupportDto,
  AdminSupportQuery as AdminSupportQueryDto,
  AdminSupportReply as AdminSupportReplyDto,
  AssignSupportRequest as AssignSupportDto,
  CreateSupportRequest as CreateSupportDto,
  DecideSupportRequest as DecideSupportDto,
  ProposeReturnRefund as ProposeReturnRefundDto,
  ReceiveSupportReturn as ReceiveSupportReturnDto,
  RecordWarrantyMilestone as RecordWarrantyMilestoneDto,
  RecordWarrantyOutcome as RecordWarrantyOutcomeDto,
  ShipExchangeRequest as ShipExchangeDto,
  SupportMessageRequest as SupportMessageDto,
} from '@ecommerce/shared'
