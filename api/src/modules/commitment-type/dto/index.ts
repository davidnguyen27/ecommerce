import { z } from 'zod'
import * as shared from '@ecommerce/shared'

// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export const CommitmentTypeDto = shared.CommitmentTypeRequest
export type CommitmentTypeInput = z.output<typeof CommitmentTypeDto>

/** Admin URL id: a malformed one is a 400, as before the move. */
export const CommitmentTypeParams = z.object({ id: z.uuid() })
