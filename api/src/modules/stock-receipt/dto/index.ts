import { z } from 'zod'

// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  StockReceiptPreviewRequest as StockReceiptPreviewDto,
  StockReceiptQuery as StockReceiptQueryDto,
  StockReceiptRequest as StockReceiptDto,
} from '@ecommerce/shared'

/** URL id: a malformed one is a 400, as before the move. */
export const ReceiptParams = z.object({ id: z.uuid() })
