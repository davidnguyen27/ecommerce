import { ErrorCode, type ProductType } from '@ecommerce/shared'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { AppError, rethrowUnique } from '../../core/errors.ts'
import { BaseCrudService } from '../../core/service/base-crud.service.ts'
import type { Category, Prisma } from '../../generated/prisma/client.ts'
import type { CreateCategoryInput, UpdateCategoryInput } from './dto/index.ts'
import type { ICategoryQuery } from './category.interface.ts'
import { toAdminCategory } from './category.mapper.ts'
import type { CategoryRepository } from './category.repository.ts'

type Update = Prisma.CategoryUncheckedUpdateInput

const slugTaken = () =>
  new AppError(409, ErrorCode.CONFLICT, 'Slug này đã có danh mục khác dùng', [
    { path: 'slug', message: 'Slug đã được dùng' },
  ])

const parentRejected = (status: 400 | 409, message: string) =>
  new AppError(status, status === 400 ? ErrorCode.VALIDATION_ERROR : ErrorCode.CONFLICT, message, [
    { path: 'parentId', message },
  ])

/** The category tree (ADR 0004): every write takes the tree lock first, then the row lock, as delete always did. */
export class CategoryService extends BaseCrudService<Category, CreateCategoryInput, Update> {
  protected readonly entityType = 'category'
  protected readonly actions = { create: 'catalog.category.create', update: 'catalog.category.update' }

  constructor(
    prisma: Db,
    protected override readonly repo: CategoryRepository,
    private readonly query: ICategoryQuery,
  ) {
    super(prisma, repo)
  }

  protected snapshot(row: Category): Prisma.InputJsonValue {
    return toAdminCategory(row)
  }

  protected override notFound() {
    return new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy danh mục')
  }

  protected override async lockForUpdate(tx: Prisma.TransactionClient, id: string) {
    await this.repo.lockTree(tx)
    return super.lockForUpdate(tx, id)
  }

  list() {
    return this.repo.findAllByName(this.prisma)
  }

  protected override async beforeCreate(tx: Prisma.TransactionClient, input: CreateCategoryInput) {
    await this.repo.lockTree(tx)
    await this.assertValidParent(tx, input, input.parentId)
  }

  override async create(input: CreateCategoryInput, ctx: RequestContext) {
    return super.create(input, ctx).catch(rethrowUnique(slugTaken))
  }

  /** Rename, change slug or reparent; the same values write nothing. */
  override async update(id: string, input: UpdateCategoryInput, ctx: RequestContext) {
    return this.updateWith(id, ctx, this.actions.update, async (tx, current) => {
      if (current.name === input.name && current.slug === input.slug && current.parentId === input.parentId) {
        return null
      }
      if (current.parentId !== input.parentId) await this.assertValidParent(tx, current, input.parentId)
      return input
    }).catch(rethrowUnique(slugTaken))
  }

  hide(id: string, ctx: RequestContext) {
    return this.updateWith(id, ctx, 'catalog.category.hide', async (_tx, current) =>
      current.hidden ? null : { hidden: true },
    )
  }

  unhide(id: string, ctx: RequestContext) {
    return this.updateWith(id, ctx, 'catalog.category.unhide', async (_tx, current) =>
      current.hidden ? { hidden: false } : null,
    )
  }

  /** Only an empty category goes; otherwise hide it. */
  async delete(id: string, ctx: RequestContext) {
    await audited(this.prisma, ctx, async (tx, audit) => {
      // Same lock as create and reparent, so no child is attached between the check and the delete. The row lock makes
      // products being attached to it (`FOR KEY SHARE`) wait, so none slips past the count.
      const before = await this.lockForUpdate(tx, id)
      if (!before) throw this.notFound()
      if (await this.repo.countChildren(tx, id)) {
        throw new AppError(409, ErrorCode.CONFLICT, 'Danh mục còn danh mục con nên không xóa được; hãy ẩn nó')
      }
      if (await this.repo.countReferences(tx, id)) {
        throw new AppError(409, ErrorCode.CONFLICT, 'Danh mục còn sản phẩm nên không xóa được; hãy ẩn nó')
      }
      await this.repo.delete(tx, id)
      await audit({
        action: 'catalog.category.delete',
        entityType: 'category',
        entityId: id,
        before: this.snapshot(before),
      })
    })
  }

  /**
   * Checks `parentId` can parent `child`: it exists, has the same product type (ADR 0004), and is not inside `child`'s
   * subtree. Call under the tree lock.
   */
  private async assertValidParent(
    tx: Prisma.TransactionClient,
    child: { id?: string; productType: ProductType },
    parentId: string | null,
  ) {
    if (parentId === null) return
    const parent = await this.repo.findById(tx, parentId)
    if (!parent) throw parentRejected(400, 'Danh mục cha không tồn tại')
    if (parent.productType !== child.productType) {
      throw parentRejected(409, 'Danh mục con phải cùng nhóm hàng với danh mục cha')
    }
    if (child.id !== undefined && (await this.repo.isAncestorOrSelf(tx, child.id, parentId))) {
      throw parentRejected(409, 'Không đặt được danh mục vào dưới chính nó hay nhánh con của nó')
    }
  }

  // ===== Public =====

  publicTree() {
    return this.query.loadVisibleTree(this.prisma)
  }

  async publicCategory(slug: string) {
    return this.query.findVisible(await this.query.loadVisibleTree(this.prisma), slug)
  }
}
