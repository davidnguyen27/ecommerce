import { PREORDER_POLICY_SLUG, PRIVACY_POLICY_SLUG } from '@ecommerce/shared'
import type { DbClient } from '../core/db.ts'

/** `include` for the page's latest version. */
export const LATEST_VERSION = { orderBy: { version: 'desc' }, take: 1 } as const

/** A page with its latest version (if published), enough to know its status. */
export function findPageWithLatest(db: DbClient, id: string) {
  return db.contentPage.findUnique({ where: { id }, include: { versions: LATEST_VERSION } })
}

export function listPagesWithLatest(db: DbClient) {
  return db.contentPage.findMany({ include: { versions: LATEST_VERSION }, orderBy: { createdAt: 'asc' } })
}

/**
 * The published version of the page by slug, or `null` when unpublished or missing. Other modules use it to store a
 * reference to the exact version the customer saw, e.g. privacy policy consent.
 */
export function findPublishedVersion(db: DbClient, slug: string) {
  return db.contentPageVersion.findFirst({
    where: { page: { slug } },
    include: { page: { select: { slug: true, kind: true } } },
    orderBy: { version: 'desc' },
  })
}

/** Current privacy policy version; customer consent stores this version's id. */
export async function findCurrentPrivacyPolicy(db: DbClient) {
  const version = await findPublishedVersion(db, PRIVACY_POLICY_SLUG)
  return version?.page.kind === 'policy' ? version : null
}

/** Current pre-order policy version; pre-orders store its id along with the other policies. */
export async function findCurrentPreorderPolicy(db: DbClient) {
  const version = await findPublishedVersion(db, PREORDER_POLICY_SLUG)
  return version?.page.kind === 'policy' ? version : null
}

/** Published pages, each with its published version. */
export async function listPublishedPages(db: DbClient) {
  const pages = await db.contentPage.findMany({
    where: { versions: { some: {} } },
    include: { versions: LATEST_VERSION },
    orderBy: { createdAt: 'asc' },
  })
  return pages.map(({ versions: [version], ...page }) => ({ ...page, version: version! }))
}
