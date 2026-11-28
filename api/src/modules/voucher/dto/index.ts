import { z } from 'zod'

// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  PageQuery as VoucherOrdersQueryDto,
  VoucherCreate as VoucherCreateDto,
  VoucherQuery as VoucherQueryDto,
  VoucherUpdate as VoucherUpdateDto,
} from '@ecommerce/shared'

/** Admin URL id: a malformed one is a 400. */
export const VoucherParams = z.object({ id: z.uuid() })
