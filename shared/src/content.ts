import { z } from 'zod'
import { Slug } from './slug.ts'

export const ContentPageKind = z.enum(['about', 'process', 'policy'])
export type ContentPageKind = z.infer<typeof ContentPageKind>

/** Slug của trang chính sách bảo mật; lời đồng ý của khách tham chiếu phiên bản hiện hành của trang này. */
export const PRIVACY_POLICY_SLUG = 'chinh-sach-bao-mat'

/** Phần sửa được của trang. Slug và loại cố định từ lúc tạo, nên khách luôn thấy chúng khớp phiên bản đang xuất bản. */
export const UpdateContentPageRequest = z.object({
  title: z.string().trim().min(1).max(200),
  /** Markdown. */
  body: z.string().max(100_000),
})
export type UpdateContentPageRequest = z.infer<typeof UpdateContentPageRequest>

export const CreateContentPageRequest = UpdateContentPageRequest.extend({ slug: Slug, kind: ContentPageKind })
export type CreateContentPageRequest = z.infer<typeof CreateContentPageRequest>

/**
 * `draft`: chưa xuất bản lần nào, khách không thấy.
 * `published`: khách thấy phiên bản `currentVersion`; `hasUnpublishedChanges` khi bản đang soạn khác phiên bản đó.
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
  /** Id để module khác (lời đồng ý, đơn hàng) lưu tham chiếu. */
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

/** Phiên bản đang xuất bản của một trang, như khách thấy. */
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
