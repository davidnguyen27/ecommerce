import {
  ErrorCode,
  type ContentPageDetail,
  type ContentPageSummary,
  type ContentPageVersion,
  type ContentPageVersionSummary,
  type CreateContentPageRequest,
  type PublishedPage,
  type PublishedPageList,
  type UpdateContentPageRequest,
} from '@ecommerce/shared'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { AppError, rethrowUnique } from '../../core/errors.ts'
import {
  sameContent,
  toPageDetail,
  toPageSummary,
  toPublishedPage,
  toVersion,
  toVersionSummary,
} from './content-page.mapper.ts'
import {
  findPageWithLatest,
  findPublishedVersion,
  listPagesWithLatest,
  listPublishedPages,
} from './content-page.query.ts'
import type { ContentPageRepository } from './content-page.repository.ts'

const slugTaken = () =>
  new AppError(409, ErrorCode.CONFLICT, 'Slug này đã có trang khác dùng', [
    { path: 'slug', message: 'Slug đã được dùng' },
  ])
const pageNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy trang nội dung')

/**
 * Content pages: staff edit a draft and publish it as a new numbered version; customers only ever see published
 * versions. Policy consents and orders point at the exact version.
 */
export class ContentPageService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: ContentPageRepository,
  ) {}

  async list(): Promise<ContentPageSummary[]> {
    return (await listPagesWithLatest(this.prisma)).map(toPageSummary)
  }

  async get(id: string): Promise<ContentPageDetail> {
    const page = await findPageWithLatest(this.prisma, id)
    if (!page) throw pageNotFound()
    return toPageDetail(page)
  }

  async create(input: CreateContentPageRequest, ctx: RequestContext): Promise<ContentPageDetail> {
    const page = await audited(this.prisma, ctx, async (tx, audit) => {
      const created = await this.repo.create(tx, input)
      await audit({ action: 'content.page.create', entityType: 'content_page', entityId: created.id, after: input })
      return created
    }).catch(rethrowUnique(slugTaken))
    return toPageDetail(page)
  }

  /** Edits the draft under the page row lock; the same title and body write nothing. */
  async update(id: string, input: UpdateContentPageRequest, ctx: RequestContext): Promise<ContentPageDetail> {
    const page = await audited(this.prisma, ctx, async (tx, audit) => {
      if (!(await this.repo.lock(tx, id))) throw pageNotFound()
      const before = (await findPageWithLatest(tx, id))!
      if (sameContent(before, input)) return before

      const after = await this.repo.update(tx, id, input)
      const { title, body } = before
      await audit({
        action: 'content.page.update',
        entityType: 'content_page',
        entityId: id,
        before: { title, body },
        after: input,
      })
      return after
    })
    return toPageDetail(page)
  }

  /**
   * Publishes the draft as the next version, under the page row lock so two publishes do not race for the number. A
   * draft identical to the published version creates no duplicate version.
   */
  async publish(id: string, ctx: RequestContext): Promise<ContentPageVersion> {
    const version = await audited(this.prisma, ctx, async (tx, audit) => {
      if (!(await this.repo.lock(tx, id))) throw pageNotFound()
      const page = await this.repo.findWithLatestPublished(tx, id)
      const latest = page.versions[0]
      if (latest && sameContent(latest, page)) return latest

      const created = await this.repo.createVersion(tx, {
        pageId: id,
        version: (latest?.version ?? 0) + 1,
        title: page.title,
        body: page.body,
        publishedById: ctx.staffId,
      })
      await audit({
        action: 'content.page.publish',
        entityType: 'content_page',
        entityId: id,
        before: latest ? { version: latest.version } : undefined,
        after: { version: created.version, versionId: created.id, title: created.title, body: created.body },
      })
      return created
    })
    return toVersion(version)
  }

  async versions(id: string): Promise<ContentPageVersionSummary[]> {
    const page = await this.repo.findWithVersions(this.prisma, id)
    if (!page) throw pageNotFound()
    return page.versions.map(toVersionSummary)
  }

  async version(id: string, version: number): Promise<ContentPageVersion> {
    const found = await this.repo.findVersion(this.prisma, id, version)
    if (!found) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy phiên bản')
    return toVersion(found)
  }

  // ===== Public =====

  async publicList(): Promise<PublishedPageList> {
    const pages = await listPublishedPages(this.prisma)
    return { items: pages.map((page) => ({ slug: page.slug, kind: page.kind, title: page.version.title })) }
  }

  async publicPage(slug: string): Promise<PublishedPage> {
    const version = await findPublishedVersion(this.prisma, slug)
    if (!version) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy trang')
    return toPublishedPage(version)
  }
}
