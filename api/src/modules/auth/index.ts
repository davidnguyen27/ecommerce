// Leaf files first, the module last (see modules/order/index.ts).
// Customer sessions, account changes that sign out every device, and the `X-Client` channel check.
export { revokeAllRefreshTokens } from './refresh-token.ts'
export { clientOf } from './auth.controller.ts'
export { sessionRouter } from './auth.route.ts'
export type { ISessions, SessionAccounts } from './auth.interface.ts'
export { AuthModule, createSessions } from './auth.module.ts'
