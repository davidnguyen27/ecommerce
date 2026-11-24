import { z } from 'zod'
import { Slug } from './slug.ts'

export const ContentPageKind = z.enum(['about', 'process', 'policy'])
export type ContentPageKind = z.infer<typeof ContentPageKind>

/** Slug of the privacy policy page; customer consent references its current version. */
export const PRIVACY_POLICY_SLUG = 'chinh-sach-bao-mat'

/**
 * Slug of the pre-order policy page (cancel/refund terms, overdue remainder). Customers agree to the current version
 * when pre-ordering, and the order stores it with the other policies.
 */
export const PREORDER_POLICY_SLUG = 'chinh-sach-dat-truoc'

/** Editable part of a page. Slug and kind are fixed at creation, so they always match the published version. */
export const UpdateContentPageRequest = z.object({
  title: z.string().trim().min(1).max(200),
  /** Markdown. */
  body: z.string().max(100_000),
})
export type UpdateContentPageRequest = z.infer<typeof UpdateContentPageRequest>

export const CreateContentPageRequest = UpdateContentPageRequest.extend({ slug: Slug, kind: ContentPageKind })
export type CreateContentPageRequest = z.infer<typeof CreateContentPageRequest>

/**
 * `draft`: never published, customers do not see it.
 * `published`: customers see `currentVersion`; `hasUnpublishedChanges` when the draft differs from it.
 */
export const ContentPageStatus = z.enum(['draft', 'published'])
export type ContentPageStatus = z.infer<typeof ContentPageStatus>

export const ContentPageSummary = z.object({
  id: z.string(),
  slug: z.string(),
  kind: ContentPageKind,
  title: z.string(),
  status: ContentPageStatus,
  currentVersion: z.number().nullable(),
  hasUnpublishedChanges: z.boolean(),
  updatedAt: z.string(),
})
export type ContentPageSummary = z.infer<typeof ContentPageSummary>

export const ContentPageDetail = ContentPageSummary.extend({ body: z.string() })
export type ContentPageDetail = z.infer<typeof ContentPageDetail>

export const ContentPageList = z.object({ items: z.array(ContentPageSummary) })
export type ContentPageList = z.infer<typeof ContentPageList>

export const ContentPageVersionSummary = z.object({
  /** Id other modules (consent, orders) store as a reference. */
  id: z.string(),
  version: z.number(),
  title: z.string(),
  publishedAt: z.string(),
  publishedBy: z.object({ id: z.string(), name: z.string() }),
})
export type ContentPageVersionSummary = z.infer<typeof ContentPageVersionSummary>

export const ContentPageVersion = ContentPageVersionSummary.extend({ body: z.string() })
export type ContentPageVersion = z.infer<typeof ContentPageVersion>

export const ContentPageVersionList = z.object({ items: z.array(ContentPageVersionSummary) })
export type ContentPageVersionList = z.infer<typeof ContentPageVersionList>

/** The published version of a page, as customers see it. */
export const PublishedPage = z.object({
  slug: z.string(),
  kind: ContentPageKind,
  title: z.string(),
  body: z.string(),
  versionId: z.string(),
  version: z.number(),
  publishedAt: z.string(),
})
export type PublishedPage = z.infer<typeof PublishedPage>

export const PublishedPageList = z.object({
  items: z.array(z.object({ slug: z.string(), kind: ContentPageKind, title: z.string() })),
})
export type PublishedPageList = z.infer<typeof PublishedPageList>
