import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  type AdminProductDocument,
  type AdminProductDocumentList,
  type DocumentUrl,
} from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import { ProductParams, loadProduct, lockProduct } from '../catalog/products.ts'
import type { Db, DbClient } from '../db.ts'
import type { ProductDocument } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'
import {
  DOCUMENT_URL_TTL_SECONDS,
  deleteDocumentFileQuietly,
  receiveDocument,
  uploadedDocument,
} from '../media/documents.ts'

const DocumentParams = z.object({ id: z.uuid(), documentId: z.uuid() })

const documentNotFound = () => new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy chứng từ')

/** Document business fields recorded in audit. */
function auditFields(document: ProductDocument) {
  const { productId, storageKey, fileName, contentType, sizeBytes } = document
  return { productId, storageKey, fileName, contentType, sizeBytes }
}

function toAdminDocument(document: ProductDocument): AdminProductDocument {
  return {
    id: document.id,
    fileName: document.fileName,
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    createdAt: document.createdAt.toISOString(),
  }
}

/**
 * Supplier documents of a product, mounted at `/products/:id/documents`. Everything needs `document.view`: documents
 * belong to partners, so only viewers can upload, open or delete. Files sit in the private bucket, opened only via
 * expiring signed URLs, and each URL issued is audited.
 */
export function adminProductDocumentRoutes(prisma: Db, storage: Storage) {
  return (
    Router({ mergeParams: true })
      .use(requirePermission('document.view'))
      .get('/', async (req, res) => {
        const { id } = parse(ProductParams, req.params)
        await loadProduct(prisma, id)
        const documents = await prisma.productDocument.findMany({
          where: { productId: id },
          orderBy: { createdAt: 'asc' },
        })
        const body: AdminProductDocumentList = { items: documents.map(toAdminDocument) }
        res.json(body)
      })
      .post('/', receiveDocument, async (req, res) => {
        const { id } = parse(ProductParams, req.params)
        const file = uploadedDocument(req)
        // Check the product first, so nothing is uploaded for a missing product.
        await loadProduct(prisma, id)

        const documentId = randomUUID()
        const storageKey = `products/${id}/documents/${documentId}`
        await storage.put({ bucket: 'private', key: storageKey, body: file.body, contentType: file.contentType })
        const created = await audited(prisma, req, async (tx, audit) => {
          await lockProduct(tx, id)
          const row = await tx.productDocument.create({
            data: {
              id: documentId,
              productId: id,
              storageKey,
              fileName: file.fileName,
              contentType: file.contentType,
              sizeBytes: file.body.length,
            },
          })
          await audit({
            action: 'document.upload',
            entityType: 'product_document',
            entityId: row.id,
            after: auditFields(row),
          })
          return row
        }).catch(async (err: unknown) => {
          await deleteDocumentFileQuietly(storage, req, storageKey)
          throw err
        })
        const body: AdminProductDocument = toAdminDocument(created)
        res.status(201).json(body)
      })
      // POST because issuing a URL is viewing the document, which is audited.
      .post('/:documentId/url', async (req, res) => {
        const { id, documentId } = parse(DocumentParams, req.params)
        const document = await findDocument(prisma, id, documentId)
        const expiresAt = new Date(Date.now() + DOCUMENT_URL_TTL_SECONDS * 1000)
        const url = await storage.signedUrl(document.storageKey, DOCUMENT_URL_TTL_SECONDS)
        await audited(prisma, req, (_tx, audit) =>
          audit({
            action: 'document.view',
            entityType: 'product_document',
            entityId: document.id,
            after: { productId: id, fileName: document.fileName, expiresAt: expiresAt.toISOString() },
          }),
        )
        const body: DocumentUrl = { url, expiresAt: expiresAt.toISOString() }
        res.json(body)
      })
      .delete('/:documentId', async (req, res) => {
        const { id, documentId } = parse(DocumentParams, req.params)
        const deleted = await audited(prisma, req, async (tx, audit) => {
          // Same lock as creating and editing commitments: a document cannot be deleted while a commitment points to
          // it.
          await lockProduct(tx, id)
          const document = await findDocument(tx, id, documentId)
          const citing = await tx.productCommitment.findMany({
            where: { documents: { some: { documentId } } },
            include: { type: true },
            orderBy: { createdAt: 'asc' },
          })
          if (citing.length > 0) {
            throw new AppError(
              409,
              ErrorCode.CONFLICT,
              `Chứng từ đang làm bằng chứng cho cam kết: ${citing.map((c) => c.type.name).join(', ')}. Gỡ hoặc sửa các cam kết đó trước`,
              citing.map((c) => ({ path: `commitments.${c.id}`, message: `${c.type.name}: ${c.statement}` })),
            )
          }
          await tx.productDocument.delete({ where: { id: documentId } })
          await audit({
            action: 'document.delete',
            entityType: 'product_document',
            entityId: documentId,
            before: auditFields(document),
          })
          return document
        })
        // Delete the file after commit: on rollback the document keeps its file.
        await deleteDocumentFileQuietly(storage, req, deleted.storageKey)
        res.status(204).end()
      })
  )
}

/** A document of exactly the product in the URL; another product's counts as missing. */
async function findDocument(db: DbClient, productId: string, documentId: string) {
  const document = await db.productDocument.findUnique({ where: { id: documentId } })
  if (!document || document.productId !== productId) throw documentNotFound()
  return document
}
