import type {
  ContentPageDetail,
  ContentPageSummary,
  ContentPageVersion,
  ContentPageVersionSummary,
  PublishedPage,
  UpdateContentPageRequest,
} from '@ecommerce/shared'
import type { ContentPage, ContentPageVersion as Version } from '../../generated/prisma/client.ts'
import type { findPublishedVersion } from './content-page.query.ts'

export type PageWithLatest = ContentPage & { versions: Version[] }
export type VersionWithPublisher = Version & { publishedBy: { id: string; name: string } }

export function sameContent(a: UpdateContentPageRequest, b: UpdateContentPageRequest) {
  return a.title === b.title && a.body === b.body
}

export function toPageSummary(page: PageWithLatest): ContentPageSummary {
  const latest = page.versions[0]
  return {
    id: page.id,
    slug: page.slug,
    kind: page.kind,
    title: page.title,
    status: latest ? 'published' : 'draft',
    currentVersion: latest?.version ?? null,
    hasUnpublishedChanges: latest ? !sameContent(latest, page) : false,
    updatedAt: page.updatedAt.toISOString(),
  }
}

export function toPageDetail(page: PageWithLatest): ContentPageDetail {
  return { ...toPageSummary(page), body: page.body }
}

export function toVersionSummary(version: VersionWithPublisher): ContentPageVersionSummary {
  return {
    id: version.id,
    version: version.version,
    title: version.title,
    publishedAt: version.publishedAt.toISOString(),
    publishedBy: version.publishedBy,
  }
}

export function toVersion(version: VersionWithPublisher): ContentPageVersion {
  return { ...toVersionSummary(version), body: version.body }
}

export function toPublishedPage(version: NonNullable<Awaited<ReturnType<typeof findPublishedVersion>>>): PublishedPage {
  return {
    slug: version.page.slug,
    kind: version.page.kind,
    title: version.title,
    body: version.body,
    versionId: version.id,
    version: version.version,
    publishedAt: version.publishedAt.toISOString(),
  }
}
