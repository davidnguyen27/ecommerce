import { Router } from 'express'
import { z } from 'zod'
import {
  CreateContentPageRequest,
  ErrorCode,
  UpdateContentPageRequest,
  type ContentPageDetail,
  type ContentPageList,
  type ContentPageSummary,
  type ContentPageVersion,
  type ContentPageVersionList,
  type ContentPageVersionSummary,
} from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { currentStaff, requirePermission } from '../auth/staff-context.ts'
import { LATEST_VERSION, findPageWithLatest, listPagesWithLatest } from '../content/pages.ts'
import type { Db } from '../db.ts'
import { Prisma, type ContentPage, type ContentPageVersion as Version } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

type PageWithLatest = ContentPage & { versions: Version[] }

function toSummary(page: PageWithLatest): ContentPageSummary {
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

function toDetail(page: PageWithLatest): ContentPageDetail {
  return { ...toSummary(page), body: page.body }
}

function sameContent(a: UpdateContentPageRequest, b: UpdateContentPageRequest) {
  return a.title === b.title && a.body === b.body
}

type VersionWithPublisher = Version & { publishedBy: { id: string; name: string } }

function toVersionSummary(version: VersionWithPublisher): ContentPageVersionSummary {
  return {
    id: version.id,
    version: version.version,
    title: version.title,
    publishedAt: version.publishedAt.toISOString(),
    publishedBy: version.publishedBy,
  }
}

function toVersion(version: VersionWithPublisher): ContentPageVersion {
  return { ...toVersionSummary(version), body: version.body }
}

const PageParams = z.object({ id: z.uuid() })
const VersionParams = PageParams.extend({ version: z.coerce.number().int().min(1) })
const PUBLISHER = { publishedBy: { select: { id: true, name: true } } } as const

const pageNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy trang nội dung')

/** Soạn và xuất bản trang nội dung; mọi route cần `content.edit`. */
export function adminPageRoutes(prisma: Db) {
  return Router()
    .use(requirePermission('content.edit'))
    .get('/', async (_req, res) => {
      const body: ContentPageList = { items: (await listPagesWithLatest(prisma)).map(toSummary) }
      res.json(body)
    })
    .post('/', async (req, res) => {
      const input = parse(CreateContentPageRequest, req.body)
      const slugTaken = new AppError(409, ErrorCode.CONFLICT, 'Slug này đã có trang khác dùng', [
        { path: 'slug', message: 'Slug đã được dùng' },
      ])
      const page = await audited(prisma, req, async (tx, audit) => {
        const created = await tx.contentPage.create({ data: input, include: { versions: true } })
        await audit({ action: 'content.page.create', entityType: 'content_page', entityId: created.id, after: input })
        return created
      }).catch((err: unknown) => {
        throw err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' ? slugTaken : err
      })
      res.status(201).json(toDetail(page))
    })
    .get('/:id', async (req, res) => {
      const { id } = parse(PageParams, req.params)
      const page = await findPageWithLatest(prisma, id)
      if (!page) throw pageNotFound()
      res.json(toDetail(page))
    })
    .put('/:id', async (req, res) => {
      const { id } = parse(PageParams, req.params)
      const input = parse(UpdateContentPageRequest, req.body)
      const page = await audited(prisma, req, async (tx, audit) => {
        const before = await findPageWithLatest(tx, id)
        if (!before) throw pageNotFound()
        if (sameContent(before, input)) return before

        const after = await tx.contentPage.update({ where: { id }, data: input, include: { versions: LATEST_VERSION } })
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
      res.json(toDetail(page))
    })
    .post('/:id/publish', async (req, res) => {
      const { id } = parse(PageParams, req.params)
      const version = await audited(prisma, req, async (tx, audit) => {
        // Khóa dòng trang để hai lần xuất bản cùng lúc không tranh nhau số phiên bản.
        const locked = await tx.$queryRaw<unknown[]>`SELECT 1 FROM content_page WHERE id = ${id}::uuid FOR UPDATE`
        if (locked.length === 0) throw pageNotFound()
        const page = await tx.contentPage.findUniqueOrThrow({
          where: { id },
          include: { versions: { ...LATEST_VERSION, include: PUBLISHER } },
        })
        const latest = page.versions[0]
        // Bản đang soạn chưa đổi gì so với phiên bản đang xuất bản thì không tạo phiên bản trùng.
        if (latest && sameContent(latest, page)) return latest

        const created = await tx.contentPageVersion.create({
          data: {
            pageId: id,
            version: (latest?.version ?? 0) + 1,
            title: page.title,
            body: page.body,
            publishedById: currentStaff(req).id,
          },
          include: PUBLISHER,
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
      res.json(toVersion(version))
    })
    .get('/:id/versions', async (req, res) => {
      const { id } = parse(PageParams, req.params)
      const page = await prisma.contentPage.findUnique({
        where: { id },
        include: { versions: { orderBy: { version: 'desc' }, include: PUBLISHER } },
      })
      if (!page) throw pageNotFound()
      const body: ContentPageVersionList = { items: page.versions.map(toVersionSummary) }
      res.json(body)
    })
    .get('/:id/versions/:version', async (req, res) => {
      const { id, version } = parse(VersionParams, req.params)
      const found = await prisma.contentPageVersion.findUnique({
        where: { pageId_version: { pageId: id, version } },
        include: PUBLISHER,
      })
      if (!found) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy phiên bản')
      res.json(toVersion(found))
    })
}
