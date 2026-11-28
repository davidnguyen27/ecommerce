import type { Request } from 'express'
import { currentStaff } from '../middleware/staff-context.ts'

/** Who acts on an admin request, as audit records it; services take this instead of `req`. */
export type RequestContext = { staffId: string; ip: string | null; userAgent: string | null }

/** The staff request's context; call only after `loadStaff`. */
export function contextOf(req: Request): RequestContext {
  return { staffId: currentStaff(req).id, ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null }
}
