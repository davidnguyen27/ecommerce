// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  StockAdjustmentRequest as StockAdjustmentDto,
  StockMovementQuery as StockMovementQueryDto,
  StockQuery as StockQueryDto,
} from '@ecommerce/shared'
