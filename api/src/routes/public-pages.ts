import { Router } from 'express'
import { z } from 'zod'
import { ErrorCode, type PublishedPage, type PublishedPageList } from '@ecommerce/shared'
import { findPublishedVersion, listPublishedPages } from '../content/pages.ts'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

const SlugParams = z.object({ slug: z.string() })

/** Khách đọc trang nội dung; chỉ phiên bản đã xuất bản lộ ra, bản đang soạn thì không. */
export function publicPageRoutes(prisma: Db) {
  return Router()
    .get('/', async (_req, res) => {
      const pages = await listPublishedPages(prisma)
      const body: PublishedPageList = {
        items: pages.map((page) => ({ slug: page.slug, kind: page.kind, title: page.version.title })),
      }
      res.json(body)
    })
    .get('/:slug', async (req, res) => {
      const { slug } = parse(SlugParams, req.params)
      const version = await findPublishedVersion(prisma, slug)
      if (!version) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy trang')
      const body: PublishedPage = {
        slug: version.page.slug,
        kind: version.page.kind,
        title: version.title,
        body: version.body,
        versionId: version.id,
        version: version.version,
        publishedAt: version.publishedAt.toISOString(),
      }
      res.json(body)
    })
}
