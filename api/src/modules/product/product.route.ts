import { Router } from 'express'
import { receiveDocument } from '../../core/media/documents.ts'
import { receiveImage } from '../../core/media/images.ts'
import type { IRoute } from '../../core/module/base.module.ts'
import { requirePermission } from '../../core/middleware/staff-context.ts'
import type { ProductCommitmentController } from './product-commitment.controller.ts'
import type { ProductMediaController } from './product-media.controller.ts'
import type { ProductController } from './product.controller.ts'

/**
 * Images of a product under `/api/admin/products/:id/images`. Viewing needs product view permission or
 * `media.upload`; upload, edit, reorder, delete need `media.upload`.
 */
export class ProductImageRoute implements IRoute {
  readonly path = '/products/:id/images'
  readonly access = 'staff'
  readonly router = Router({ mergeParams: true })

  constructor(c: ProductMediaController) {
    const upload = requirePermission('media.upload')
    this.router
      .get('/', requirePermission('catalog.edit', 'price.edit', 'media.upload'), c.images)
      .post('/', upload, receiveImage, c.uploadImage)
      // Declared before `/:imageId` so `order` is not read as an image id.
      .put('/order', upload, c.reorderImages)
      .put('/:imageId', upload, c.updateImage)
      .delete('/:imageId', upload, c.deleteImage)
  }
}

/** Product lifecycle and policy pages under `/api/admin/products/:id`; needs `catalog.edit`. */
export class ProductPublishingRoute implements IRoute {
  readonly path = '/products/:id'
  readonly access = 'staff'
  readonly router = Router({ mergeParams: true })

  constructor(c: ProductController) {
    const edit = requirePermission('catalog.edit')
    this.router.put('/status', edit, c.changeStatus).put('/policies', edit, c.setPolicies)
  }
}

/**
 * Supplier documents under `/api/admin/products/:id/documents`. Everything needs `document.view`: documents belong to
 * partners, so only viewers can upload, open or delete. Each signed URL issued is audited.
 */
export class ProductDocumentRoute implements IRoute {
  readonly path = '/products/:id/documents'
  readonly access = 'staff'
  readonly router = Router({ mergeParams: true })

  constructor(c: ProductMediaController) {
    this.router
      .use(requirePermission('document.view'))
      .get('/', c.documents)
      .post('/', receiveDocument, c.uploadDocument)
      // POST because issuing a URL is viewing the document, which is audited.
      .post('/:documentId/url', c.documentUrl)
      .delete('/:documentId', c.deleteDocument)
  }
}

/**
 * Evidenced commitments under `/api/admin/products/:id/commitments`. Anyone editing products can view; create, edit,
 * remove need `commitment.edit`.
 */
export class ProductCommitmentRoute implements IRoute {
  readonly path = '/products/:id/commitments'
  readonly access = 'staff'
  readonly router = Router({ mergeParams: true })

  constructor(c: ProductCommitmentController) {
    const edit = requirePermission('commitment.edit')
    this.router
      .get('/', requirePermission('catalog.edit', 'price.edit', 'document.view', 'commitment.edit'), c.list)
      .post('/', edit, c.create)
      .put('/:commitmentId', edit, c.update)
      .delete('/:commitmentId', edit, c.delete)
  }
}

/**
 * Products and variants under `/api/admin/products`. Viewing needs `catalog.edit` or `price.edit` (price-only editors
 * must see variants); editing products and variants needs `catalog.edit`; changing prices `price.edit`.
 */
export class ProductAdminRoute implements IRoute {
  readonly path = '/products'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: ProductController) {
    const edit = requirePermission('catalog.edit')
    this.router
      .use(requirePermission('catalog.edit', 'price.edit'))
      .get('/', c.list)
      // Before `/:id`.
      .get('/policy-pages', c.policyPages)
      .get('/:id', c.detail)
      .post('/', edit, c.create)
      .put('/:id', edit, c.update)
      .post('/:id/variants', edit, c.createVariant)
      // Price-only editors also use this route to change prices, sending the other fields unchanged.
      .put('/:id/variants/:variantId', requirePermission('catalog.edit', 'price.edit'), c.updateVariant)
  }
}

/** Bulk images under `/api/admin/images`: one file per request, the file name gives the SKU; needs `media.upload`. */
export class BulkImageRoute implements IRoute {
  readonly path = '/images'
  readonly access = 'staff'
  readonly router = Router()

  constructor(c: ProductMediaController) {
    this.router.post('/by-sku', requirePermission('media.upload'), receiveImage, c.uploadBySku)
  }
}

/** Products as customers see them under `/api/products`. */
export class ProductPublicRoute implements IRoute {
  readonly path = '/products'
  readonly access = 'public'
  readonly router = Router()

  constructor(c: ProductController) {
    this.router.get('/', c.publicList).get('/:slug', c.publicDetail)
  }
}
