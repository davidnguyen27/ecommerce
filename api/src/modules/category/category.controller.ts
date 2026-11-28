import type { Request, Response } from 'express'
import {
  ErrorCode,
  type AdminCategory,
  type AdminCategoryList,
  type CategoryTree,
  type PublicCategory,
} from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { BaseCrudController } from '../../core/controller/base-crud.controller.ts'
import { AppError } from '../../core/errors.ts'
import { parse } from '../../core/middleware/validation.ts'
import type { Category } from '../../generated/prisma/client.ts'
import { CategoryParams, CreateCategoryDto, SlugParams, UpdateCategoryDto } from './dto/index.ts'
import { toAdminCategory, toCategoryNode, toPublicCategory } from './category.mapper.ts'
import type { CategoryService } from './category.service.ts'

export class CategoryController extends BaseCrudController<
  Category,
  typeof CreateCategoryDto,
  typeof UpdateCategoryDto,
  AdminCategory
> {
  constructor(protected override readonly service: CategoryService) {
    super(service, { create: CreateCategoryDto, update: UpdateCategoryDto }, toAdminCategory)
  }

  protected override idOf(req: Request) {
    return parse(CategoryParams, req.params).id
  }

  // ===== Admin =====

  list = async (_req: Request, res: Response) => {
    const body: AdminCategoryList = { items: (await this.service.list()).map(toAdminCategory) }
    res.json(body)
  }

  hide = async (req: Request, res: Response) => {
    const body: AdminCategory = toAdminCategory(await this.service.hide(this.idOf(req), contextOf(req)))
    res.json(body)
  }

  unhide = async (req: Request, res: Response) => {
    const body: AdminCategory = toAdminCategory(await this.service.unhide(this.idOf(req), contextOf(req)))
    res.json(body)
  }

  deleteItem = async (req: Request, res: Response) => {
    await this.service.delete(this.idOf(req), contextOf(req))
    res.status(204).end()
  }

  // ===== Public =====

  tree = async (_req: Request, res: Response) => {
    const tree = await this.service.publicTree()
    const body: CategoryTree = {
      items: tree.map((root) => ({ productType: root.productType, children: root.children.map(toCategoryNode) })),
    }
    res.json(body)
  }

  bySlug = async (req: Request, res: Response) => {
    const { slug } = parse(SlugParams, req.params)
    const found = await this.service.publicCategory(slug)
    if (!found) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy danh mục')
    const body: PublicCategory = toPublicCategory(found)
    res.json(body)
  }
}
