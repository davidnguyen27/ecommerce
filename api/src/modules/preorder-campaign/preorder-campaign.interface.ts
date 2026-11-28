import type { applyArrivals, planArrivals } from './preorder-arrival.ts'
import type { usedAllocations, preorderOffers } from './preorder-campaign.query.ts'
import type { checkPreorder } from './preorder-check.ts'
import type { processRemainderDeadlines } from './preorder-deadline.ts'
import type { createRemainderLink } from './preorder-remainder.ts'

/**
 * What other code uses of pre-orders (ADR 0012, 0013): arrival allocation (receipts, paid cancels), pre-order offers
 * (product pages), allocation counts (reconciliation), the placement check, the remaining-balance link and the
 * deadline job. Each takes the caller's `db` or transaction.
 */
export interface IPreorderApi {
  planArrivals: typeof planArrivals
  applyArrivals: typeof applyArrivals
  preorderOffers: typeof preorderOffers
  usedAllocations: typeof usedAllocations
  checkPreorder: typeof checkPreorder
  createRemainderLink: typeof createRemainderLink
  processRemainderDeadlines: typeof processRemainderDeadlines
}
