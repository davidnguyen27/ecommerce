import type { DbClient } from '../../core/db.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { LATEST_VERSION } from './content-page.query.ts'

const PUBLISHER = { publishedBy: { select: { id: true, name: true } } } as const

/** Content page drafts and their published versions. Every method takes `db`. */
export class ContentPageRepository {
  /** Locks the page row until the transaction ends; `false` when there is no such page. */
  async lock(tx: Prisma.TransactionClient, id: string) {
    const locked = await tx.$queryRaw<unknown[]>`SELECT 1 FROM content_page WHERE id = ${id}::uuid FOR UPDATE`
    return locked.length > 0
  }

  create(db: DbClient, data: Prisma.ContentPageCreateInput) {
    return db.contentPage.create({ data, include: { versions: true } })
  }

  update(db: DbClient, id: string, data: Prisma.ContentPageUpdateInput) {
    return db.contentPage.update({ where: { id }, data, include: { versions: LATEST_VERSION } })
  }

  /** The page with its latest version and that version's publisher. */
  findWithLatestPublished(db: DbClient, id: string) {
    return db.contentPage.findUniqueOrThrow({
      where: { id },
      include: { versions: { ...LATEST_VERSION, include: PUBLISHER } },
    })
  }

  createVersion(db: DbClient, data: Prisma.ContentPageVersionUncheckedCreateInput) {
    return db.contentPageVersion.create({ data, include: PUBLISHER })
  }

  findWithVersions(db: DbClient, id: string) {
    return db.contentPage.findUnique({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' }, include: PUBLISHER } },
    })
  }

  findVersion(db: DbClient, pageId: string, version: number) {
    return db.contentPageVersion.findUnique({ where: { pageId_version: { pageId, version } }, include: PUBLISHER })
  }
}
