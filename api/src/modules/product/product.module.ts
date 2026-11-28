import type { AppDeps } from '../../app.ts'
import type { Db } from '../../core/db.ts'
import type { Storage } from '../../core/adapters/storage.ts'
import { BaseModule, type IRoute } from '../../core/module/base.module.ts'
// Adapters to code not moved into modules yet.
import { preorderOffers } from '../../preorders/campaigns.ts'
import { inStockIds } from '../../stock/stock.ts'
import type { IAttributeSchemaQuery } from '../attribute-schema/index.ts'
import type { ICategoryQuery } from '../category/index.ts'
import { ProductCommitmentController } from './product-commitment.controller.ts'
import { ProductCommitmentService } from './product-commitment.service.ts'
import { ProductMediaController } from './product-media.controller.ts'
import { ProductMediaService } from './product-media.service.ts'
import { ProductSearchRepository } from './product-search.repository.ts'
import { ProductController } from './product.controller.ts'
import type { IProductQuery, ProductPorts } from './product.interface.ts'
import { ProductQuery } from './product.query.ts'
import { ProductRepository } from './product.repository.ts'
import {
  BulkImageRoute,
  ProductAdminRoute,
  ProductCommitmentRoute,
  ProductDocumentRoute,
  ProductImageRoute,
  ProductPublicRoute,
  ProductPublishingRoute,
} from './product.route.ts'
import { ProductService } from './product.service.ts'

const legacyPorts = (): ProductPorts => ({ stock: { inStockIds }, preorders: { offers: preorderOffers } })

/** What the product module needs from other modules. */
export type ProductModuleDeps = { schemas: IAttributeSchemaQuery; categories: ICategoryQuery }

/** Wires repositories → services and query → controllers → routes. Checkout, chatbot and support use `query`. */
export class ProductModule extends BaseModule {
  readonly routes: readonly IRoute[]
  readonly query: IProductQuery

  constructor(deps: Pick<AppDeps, 'prisma' | 'storage'>, modules: ProductModuleDeps) {
    super()
    const { prisma, storage } = deps
    const repo = new ProductRepository()
    const products = new ProductService(prisma, repo, modules.schemas, storage)
    const media = new ProductMediaService(prisma, repo, products, storage)
    const commitments = new ProductCommitmentService(prisma, repo, products)
    const query = createQuery(deps, repo, modules)

    const productController = new ProductController(products, query)
    const mediaController = new ProductMediaController(media, storage)
    // Order matters: the sub-resources have their own permissions, so they mount before the `/products` guard.
    this.routes = [
      new ProductImageRoute(mediaController),
      new ProductPublishingRoute(productController),
      new ProductDocumentRoute(mediaController),
      new ProductCommitmentRoute(new ProductCommitmentController(commitments)),
      new ProductAdminRoute(productController),
      new BulkImageRoute(mediaController),
      new ProductPublicRoute(productController),
    ]
    this.query = query
  }
}

function createQuery(deps: { prisma: Db; storage: Storage }, repo: ProductRepository, modules: ProductModuleDeps) {
  return new ProductQuery(deps, repo, new ProductSearchRepository(), modules.schemas, modules.categories, legacyPorts())
}

/**
 * The product query for code outside `modules/` with no module wiring yet (chatbot). Removed once that moves
 * (ticket 09).
 */
export function createProductQuery(deps: { prisma: Db; storage: Storage }, modules: ProductModuleDeps): IProductQuery {
  return createQuery(deps, new ProductRepository(), modules)
}
