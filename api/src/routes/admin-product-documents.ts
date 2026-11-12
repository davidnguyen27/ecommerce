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

/** Trường nghiệp vụ của chứng từ ghi vào audit. */
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
 * Chứng từ nguồn hàng của một sản phẩm, mount tại `/products/:id/documents`. Mọi thao tác cần `document.view`:
 * chứng từ là tài liệu của đối tác, chỉ người được xem mới tải lên, mở hay xóa. File nằm trên bucket private,
 * chỉ mở được qua URL ký có hạn, và mỗi lần cấp URL đều ghi audit.
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
        // Kiểm sản phẩm trước, để không đẩy file lên storage cho sản phẩm không có.
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
      // POST vì mỗi lần cấp URL là một lần xem chứng từ, phải ghi audit.
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
          // Cùng khóa với việc tạo, sửa cam kết: chứng từ không bị xóa giữa lúc cam kết đang trỏ tới nó.
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
        // Xóa file sau khi commit: rollback thì chứng từ vẫn còn file.
        await deleteDocumentFileQuietly(storage, req, deleted.storageKey)
        res.status(204).end()
      })
  )
}

/** Chứng từ thuộc đúng sản phẩm trên URL; chứng từ của sản phẩm khác coi như không có. */
async function findDocument(db: DbClient, productId: string, documentId: string) {
  const document = await db.productDocument.findUnique({ where: { id: documentId } })
  if (!document || document.productId !== productId) throw documentNotFound()
  return document
}
