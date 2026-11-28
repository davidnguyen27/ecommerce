import { z } from 'zod'

// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  CancelUnsuppliedRequest as CancelUnsuppliedDto,
  PreorderCampaignCreate as PreorderCampaignCreateDto,
  PreorderCampaignQuery as PreorderCampaignQueryDto,
  PreorderCampaignUpdate as PreorderCampaignUpdateDto,
} from '@ecommerce/shared'

/** URL id: a malformed one is a 400, as before the move. */
export const CampaignParams = z.object({ id: z.uuid() })
