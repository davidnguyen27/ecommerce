import { Router } from 'express'
import type { IRoute } from '../../core/module/base.module.ts'
import type { HealthController } from './health.controller.ts'

/** `GET /healthz`, outside `/api`: `app.ts` mounts it at the root, before the API router. */
export class HealthRoute implements IRoute {
  readonly path = '/healthz'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: HealthController) {
    this.router.get('/', c.check)
  }
}
