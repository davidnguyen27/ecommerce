export { PreorderCampaignModule, preorderApi } from './preorder-campaign.module.ts'
export type { IPreorderApi } from './preorder-campaign.interface.ts'
export type { OpenCampaign, PreorderCheck } from './preorder-check.ts'
export type { PreorderOffer } from './preorder-campaign.query.ts'
// Called directly by code not moved yet (placement, reconciliation) and by the jobs and their tests.
export { checkPreorder } from './preorder-check.ts'
export { processRemainderDeadlines } from './preorder-deadline.ts'
export { usedAllocations } from './preorder-campaign.query.ts'
