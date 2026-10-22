import { PRIVACY_POLICY_SLUG } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'

/** `include` lấy phiên bản mới nhất của trang. */
export const LATEST_VERSION = { orderBy: { version: 'desc' }, take: 1 } as const

/** Trang kèm phiên bản mới nhất (nếu đã xuất bản), đủ để biết trạng thái. */
export function findPageWithLatest(db: DbClient, id: string) {
  return db.contentPage.findUnique({ where: { id }, include: { versions: LATEST_VERSION } })
}

export function listPagesWithLatest(db: DbClient) {
  return db.contentPage.findMany({ include: { versions: LATEST_VERSION }, orderBy: { createdAt: 'asc' } })
}

/**
 * Phiên bản đang xuất bản của trang theo slug, hoặc `null` khi trang chưa xuất bản hay không có.
 * Module khác dùng hàm này để lưu tham chiếu tới đúng phiên bản khách đã thấy, ví dụ lời đồng ý chính sách bảo mật.
 */
export function findPublishedVersion(db: DbClient, slug: string) {
  return db.contentPageVersion.findFirst({
    where: { page: { slug } },
    include: { page: { select: { slug: true, kind: true } } },
    orderBy: { version: 'desc' },
  })
}

/** Phiên bản hiện hành của chính sách bảo mật; lời đồng ý của khách lưu id phiên bản này. */
export async function findCurrentPrivacyPolicy(db: DbClient) {
  const version = await findPublishedVersion(db, PRIVACY_POLICY_SLUG)
  return version?.page.kind === 'policy' ? version : null
}

/** Các trang đã xuất bản, mỗi trang kèm phiên bản đang xuất bản. */
export async function listPublishedPages(db: DbClient) {
  const pages = await db.contentPage.findMany({
    where: { versions: { some: {} } },
    include: { versions: LATEST_VERSION },
    orderBy: { createdAt: 'asc' },
  })
  return pages.map(({ versions: [version], ...page }) => ({ ...page, version: version! }))
}
