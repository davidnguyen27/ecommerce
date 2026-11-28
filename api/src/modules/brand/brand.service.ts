import { randomUUID } from 'node:crypto'
import { ErrorCode } from '@ecommerce/shared'
import type { Logger } from 'pino'
import type { Storage } from '../../core/adapters/storage.ts'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { AppError, rethrowUnique } from '../../core/errors.ts'
import { LOGO_WIDTHS, deleteImageFilesQuietly, storeImage, type StoredImage } from '../../core/media/images.ts'
import { BaseCrudService } from '../../core/service/base-crud.service.ts'
import { Prisma, type Brand } from '../../generated/prisma/client.ts'
import type { BrandInput } from './dto/index.ts'
import type { IBrandQuery } from './brand.interface.ts'
import { brandAuditFields, logoOf } from './brand.mapper.ts'
import type { BrandRepository } from './brand.repository.ts'

type Update = Prisma.BrandUncheckedUpdateInput

const slugTaken = () =>
  new AppError(409, ErrorCode.CONFLICT, 'Slug này đã có thương hiệu khác dùng', [
    { path: 'slug', message: 'Slug đã được dùng' },
  ])

/** Brands: CRUD with hide/unhide, and logos stored outside the DB (deleted after commit when replaced). */
export class BrandService extends BaseCrudService<Brand, BrandInput, Update> implements IBrandQuery {
  protected readonly entityType = 'brand'
  protected readonly actions = { create: 'catalog.brand.create', update: 'catalog.brand.update' }

  constructor(
    prisma: Db,
    protected override readonly repo: BrandRepository,
    private readonly storage: Storage,
  ) {
    super(prisma, repo)
  }

  protected snapshot(row: Brand): Prisma.InputJsonValue {
    return brandAuditFields(row)
  }

  protected override notFound() {
    return new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy thương hiệu')
  }

  list() {
    return this.repo.findAllByName(this.prisma)
  }

  override async create(input: BrandInput, ctx: RequestContext) {
    return super.create(input, ctx).catch(rethrowUnique(slugTaken))
  }

  /** The same name, slug and description write nothing. */
  override async update(id: string, input: BrandInput, ctx: RequestContext) {
    return this.updateWith(id, ctx, this.actions.update, async (_tx, current) =>
      current.name === input.name && current.slug === input.slug && current.description === input.description
        ? null
        : input,
    ).catch(rethrowUnique(slugTaken))
  }

  hide(id: string, ctx: RequestContext) {
    return this.updateWith(id, ctx, 'catalog.brand.hide', async (_tx, current) =>
      current.hidden ? null : { hidden: true },
    )
  }

  unhide(id: string, ctx: RequestContext) {
    return this.updateWith(id, ctx, 'catalog.brand.unhide', async (_tx, current) =>
      current.hidden ? { hidden: false } : null,
    )
  }

  /** Stores a new logo under a new prefix (the URL changes, so the CDN never serves the old one), then sets it. */
  async uploadLogo(id: string, file: Buffer, ctx: RequestContext, log: Logger) {
    await this.getItem(id)
    const logo = await storeImage(this.storage, `brands/${id}/${randomUUID()}`, file, LOGO_WIDTHS)
    return this.setLogo(id, logo, ctx, log).catch(async (err: unknown) => {
      await deleteImageFilesQuietly(this.storage, { log }, logo)
      throw err
    })
  }

  /**
   * Sets a new logo (`null` removes it) with audit; the old logo is deleted from storage after commit. Locks the brand
   * row so two concurrent logo changes never leave a replaced file behind.
   */
  async setLogo(id: string, logo: StoredImage | null, ctx: RequestContext, log: Logger) {
    const { before, after } = await audited(this.prisma, ctx, async (tx, audit) => {
      const before = await this.repo.lockById(tx, id)
      if (!before) throw this.notFound()
      if (before.logo === null && logo === null) return { before, after: before }

      const after = await this.repo.update(tx, id, { logo: logo ?? Prisma.DbNull })
      await audit({
        action: logo ? 'media.brand_logo.upload' : 'media.brand_logo.delete',
        entityType: 'brand',
        entityId: id,
        before: { logo: before.logo ?? null },
        after: { logo: logo ?? null },
      })
      return { before, after }
    })
    const old = logoOf(before)
    if (old) await deleteImageFilesQuietly(this.storage, { log }, old)
    return after
  }

  // ===== Public =====

  publicList() {
    return this.repo.findVisibleNames(this.prisma)
  }

  async publicBrand(slug: string) {
    const brand = await this.repo.findVisibleBySlug(this.prisma, slug)
    if (!brand) throw this.notFound()
    return brand
  }
}
