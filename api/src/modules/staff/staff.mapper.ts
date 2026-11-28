import type { StaffSummary } from '@ecommerce/shared'
import type { Staff } from '../../generated/prisma/client.ts'

/** The response shape, and what audit keeps (never the password hash). */
export function toStaffSummary(staff: Staff): StaffSummary {
  return {
    id: staff.id,
    email: staff.email,
    name: staff.name,
    roles: staff.roles,
    locked: staff.lockedAt !== null,
    createdAt: staff.createdAt.toISOString(),
  }
}
