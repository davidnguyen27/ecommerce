import type { Router } from 'express'

/**
 * Who may call a router; `app.ts` puts the matching sign-in in front. `staff` routers mount under `/api/admin`, the
 * others under `/api`.
 */
export type RouteAccess = 'public' | 'customer' | 'staff'

/** One router of a module and where it mounts, e.g. `{ path: '/categories', access: 'staff', router }`. */
export interface IRoute {
  path: string
  access: RouteAccess
  router: Router
}

/**
 * A module wires its repository, service, controller and routes in its constructor (no DI container) and exposes the
 * routes to mount. Other modules reach it only through the query interface it exports from its `index.ts`.
 */
export abstract class BaseModule {
  abstract readonly routes: readonly IRoute[]
}
