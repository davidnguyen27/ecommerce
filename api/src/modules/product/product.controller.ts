import type { Request, Response } from 'express'
import {
  ErrorCode,
  attributeFiltersOf,
  type AdminProductList,
  type PolicyPageOptionList,
  type ProductSearchResult,
  type PublicProduct,
} from '@ecommerce/shared'
import { contextOf } from '../../core/context/request-context.ts'
import { AppError } from '../../core/errors.ts'
import { currentStaff, hasPermission } from '../../core/middleware/staff-context.ts'
import { parse } from '../../core/middleware/validation.ts'
import {
  ChangeProductStatusDto,
  ProductDto,
  ProductListQueryDto,
  ProductParams,
  ProductPoliciesDto,
  SlugParams,
  VariantDto,
  VariantParams,
} from './dto/index.ts'
import type { VariantActor } from './product.interface.ts'
import { toAdminProduct, toAdminProductDetail, toAdminProductSummary } from './product.mapper.ts'
import type { ProductQuery } from './product.query.ts'
import type { ProductService } from './product.service.ts'

/** The signed-in staff member as a variant editor. */
const variantActor = (req: Request): VariantActor => ({
  staffId: currentStaff(req).id,
  canEditCatalog: hasPermission(req, 'catalog.edit'),
  canEditPrice: hasPermission(req, 'price.edit'),
})

/** Products, variants, publishing (admin) and the product list and page (customers). URL ids before the body. */
export class ProductController {
  constructor(
    private readonly service: ProductService,
    private readonly query: ProductQuery,
  ) {}

  // ===== Admin =====

  list = async (_req: Request, res: Response) => {
    const body: AdminProductList = { items: (await this.service.list()).map(toAdminProductSummary) }
    res.json(body)
  }

  policyPages = async (_req: Request, res: Response) => {
    const pages = await this.service.policyPageOptions()
    const body: PolicyPageOptionList = {
      items: pages.map((p) => ({ id: p.id, slug: p.slug, title: p.title, published: p._count.versions > 0 })),
    }
    res.json(body)
  }

  detail = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    res.json(toAdminProductDetail(await this.service.draft(id)))
  }

  create = async (req: Request, res: Response) => {
    const input = parse(ProductDto, req.body)
    res.status(201).json(toAdminProduct(await this.service.create(input, contextOf(req))))
  }

  update = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    const input = parse(ProductDto, req.body)
    res.json(toAdminProduct(await this.service.update(id, input, contextOf(req))))
  }

  createVariant = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    const input = parse(VariantDto, req.body)
    res.status(201).json(await this.service.createVariant(id, input, variantActor(req), contextOf(req)))
  }

  updateVariant = async (req: Request, res: Response) => {
    const { id, variantId } = parse(VariantParams, req.params)
    const input = parse(VariantDto, req.body)
    res.json(await this.service.updateVariant(id, variantId, input, variantActor(req), contextOf(req)))
  }

  changeStatus = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    const { status } = parse(ChangeProductStatusDto, req.body)
    res.json(toAdminProductDetail(await this.service.changeStatus(id, status, contextOf(req), req.log)))
  }

  setPolicies = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    const { pageIds } = parse(ProductPoliciesDto, req.body)
    res.json(toAdminProductDetail(await this.service.setPolicies(id, pageIds, contextOf(req))))
  }

  // ===== Customers =====

  publicList = async (req: Request, res: Response) => {
    const query = parse(ProductListQueryDto, { ...req.query, attributes: attributeFiltersOf(req.query) })
    const body: ProductSearchResult = await this.query.publicSearch(query)
    res.json(body)
  }

  publicDetail = async (req: Request, res: Response) => {
    const { slug } = parse(SlugParams, req.params)
    const product = await this.query.findPublicProduct(slug)
    if (!product) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy sản phẩm')
    const body: PublicProduct = product
    res.json(body)
  }
}
