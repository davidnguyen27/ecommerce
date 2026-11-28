import cookieParser from 'cookie-parser'
import { Router } from 'express'
import type { StaffProfile } from '@ecommerce/shared'
import { currentStaff } from '../../core/middleware/staff-context.ts'
import type { IRoute } from '../../core/module/base.module.ts'
import type { SessionController } from './auth.controller.ts'

/** `POST /login`, `POST /refresh`, `DELETE /refresh` (sign-out); no access token required. */
export function sessionRouter(c: SessionController) {
  return Router().use(cookieParser()).post('/login', c.login).post('/refresh', c.refresh).delete('/refresh', c.logout)
}

/** Staff sign-in, refresh and sign-out under `/api/admin/auth`, before any staff sign-in check. */
export class StaffSessionRoute implements IRoute {
  readonly path = '/admin/auth'
  readonly access = 'public'
  readonly router: Router

  constructor(c: SessionController) {
    this.router = sessionRouter(c)
  }
}

/** The signed-in staff member, with permissions, under `/api/admin/me`. */
export class StaffProfileRoute implements IRoute {
  readonly path = '/me'
  readonly access = 'staff'
  readonly router = Router()

  constructor() {
    this.router.get('/', (req, res) => {
      const body: StaffProfile = currentStaff(req)
      res.json(body)
    })
  }
}
