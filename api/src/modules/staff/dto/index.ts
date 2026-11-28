import { z } from 'zod'

// Request schemas come from @ecommerce/shared, so web and API share one contract (ADR 0018).
export {
  ChangeRolesRequest as ChangeRolesDto,
  CreateStaffRequest as CreateStaffDto,
  UpdateStaffRequest as UpdateStaffDto,
} from '@ecommerce/shared'

/** Admin URL id: a malformed one is a 400. */
export const StaffParams = z.object({ id: z.uuid() })
