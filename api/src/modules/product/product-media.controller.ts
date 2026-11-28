import type { Request, Response } from 'express'
import type {
  AdminProductDocument,
  AdminProductDocumentList,
  AdminProductImageList,
  BulkImageResult,
  DocumentUrl,
} from '@ecommerce/shared'
import type { Storage } from '../../core/adapters/storage.ts'
import { contextOf } from '../../core/context/request-context.ts'
import { uploadedDocument } from '../../core/media/documents.ts'
import { uploadedFile } from '../../core/media/images.ts'
import { parse } from '../../core/middleware/validation.ts'
import {
  DocumentParams,
  ImageParams,
  ProductParams,
  ReorderProductImagesDto,
  UpdateProductImageDto,
  UploadProductImageDto,
} from './dto/index.ts'
import type { ProductMediaService } from './product-media.service.ts'
import { toAdminDocument, toAdminImage } from './product.mapper.ts'

/** Product images (and bulk upload by SKU) and supplier documents. URL ids before the body, as always. */
export class ProductMediaController {
  constructor(
    private readonly service: ProductMediaService,
    private readonly storage: Storage,
  ) {}

  // ===== Images =====

  images = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    const body: AdminProductImageList = {
      items: (await this.service.images(id)).map((i) => toAdminImage(this.storage, i)),
    }
    res.json(body)
  }

  uploadImage = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    const { alt } = parse(UploadProductImageDto, req.body)
    const file = uploadedFile(req)
    const created = await this.service.uploadImage(id, file, alt, contextOf(req), req.log)
    res.status(201).json(toAdminImage(this.storage, created))
  }

  reorderImages = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    const { imageIds } = parse(ReorderProductImagesDto, req.body)
    const images = await this.service.reorderImages(id, imageIds, contextOf(req))
    const body: AdminProductImageList = { items: images.map((i) => toAdminImage(this.storage, i)) }
    res.json(body)
  }

  updateImage = async (req: Request, res: Response) => {
    const { id, imageId } = parse(ImageParams, req.params)
    const input = parse(UpdateProductImageDto, req.body)
    res.json(toAdminImage(this.storage, await this.service.updateImage(id, imageId, input, contextOf(req))))
  }

  deleteImage = async (req: Request, res: Response) => {
    const { id, imageId } = parse(ImageParams, req.params)
    await this.service.deleteImage(id, imageId, contextOf(req), req.log)
    res.status(204).end()
  }

  uploadBySku = async (req: Request, res: Response) => {
    const file = uploadedFile(req)
    const { variant, image } = await this.service.uploadBySku(req.file!.originalname, file, contextOf(req), req.log)
    const body: BulkImageResult = {
      productId: variant.productId,
      sku: variant.sku,
      image: toAdminImage(this.storage, image),
    }
    res.status(201).json(body)
  }

  // ===== Documents =====

  documents = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    const body: AdminProductDocumentList = { items: (await this.service.documents(id)).map(toAdminDocument) }
    res.json(body)
  }

  uploadDocument = async (req: Request, res: Response) => {
    const { id } = parse(ProductParams, req.params)
    const file = uploadedDocument(req)
    const body: AdminProductDocument = toAdminDocument(
      await this.service.uploadDocument(id, file, contextOf(req), req.log),
    )
    res.status(201).json(body)
  }

  documentUrl = async (req: Request, res: Response) => {
    const { id, documentId } = parse(DocumentParams, req.params)
    const { url, expiresAt } = await this.service.documentUrl(id, documentId, contextOf(req))
    const body: DocumentUrl = { url, expiresAt: expiresAt.toISOString() }
    res.json(body)
  }

  deleteDocument = async (req: Request, res: Response) => {
    const { id, documentId } = parse(DocumentParams, req.params)
    await this.service.deleteDocument(id, documentId, contextOf(req), req.log)
    res.status(204).end()
  }
}
