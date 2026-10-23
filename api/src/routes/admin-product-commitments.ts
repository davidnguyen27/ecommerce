import { isDeepStrictEqual } from 'node:util'
import { Router } from 'express'
import { z } from 'zod'
import { CommitmentRequest, ErrorCode, type AdminCommitment, type AdminCommitmentList } from '@ecommerce/shared'
import { audited } from '../audit/audited.ts'
import { requirePermission } from '../auth/staff-context.ts'
import {
  WITH_TYPE_AND_DOCUMENTS,
  commitmentsOf,
  documentIdsOf,
  toAdminCommitment,
  type CommitmentWithEvidence,
} from '../catalog/commitments.ts'
import { loadProduct, lockProduct } from '../catalog/products.ts'
import type { Db } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

const ProductParams = z.object({ id: z.uuid() })
const CommitmentParams = z.object({ id: z.uuid(), commitmentId: z.uuid() })

const invalid = (path: string, message: string) =>
  new AppError(400, ErrorCode.VALIDATION_ERROR, message, [{ path, message }])

/** Trường nghiệp vụ của cam kết ghi vào audit. */
function auditFields(commitment: CommitmentWithEvidence) {
  const { productId, typeId, statement } = commitment
  return { productId, typeId, statement, documentIds: documentIdsOf(commitment) }
}

function rethrowTypeTaken(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const message = 'Sản phẩm đã có cam kết thuộc loại này'
    throw new AppError(409, ErrorCode.CONFLICT, message, [{ path: 'typeId', message }])
  }
  throw err
}

/**
 * Kiểm loại cam kết có trong danh sách và mọi chứng từ thuộc chính sản phẩm; trả danh sách chứng từ đã bỏ trùng.
 * Chạy sau `lockProduct`, nên chứng từ không bị xóa giữa lúc kiểm và lúc ghi.
 */
async function assertEvidence(tx: Prisma.TransactionClient, productId: string, input: CommitmentRequest) {
  if (!(await tx.commitmentType.findUnique({ where: { id: input.typeId } }))) {
    throw invalid('typeId', 'Loại cam kết không có trong danh sách')
  }
  const own = await tx.productDocument.findMany({
    where: { productId, id: { in: input.documentIds } },
    select: { id: true },
  })
  const ownIds = new Set(own.map((d) => d.id))
  const foreign = input.documentIds.findIndex((id) => !ownIds.has(id))
  if (foreign !== -1) throw invalid(`documentIds.${foreign}`, 'Chỉ dựa được trên chứng từ của chính sản phẩm này')
  return [...ownIds].sort()
}

/**
 * Cam kết có bằng chứng của một sản phẩm, mount tại `/products/:id/commitments`. Ai soạn sản phẩm cũng xem được;
 * tạo, sửa, gỡ cần `commitment.edit`. Ghi khóa dòng sản phẩm, cùng khóa với việc xóa chứng từ.
 */
export function adminProductCommitmentRoutes(prisma: Db) {
  return Router({ mergeParams: true })
    .get('/', requirePermission('catalog.edit', 'price.edit', 'document.view', 'commitment.edit'), async (req, res) => {
      const { id } = parse(ProductParams, req.params)
      await loadProduct(prisma, id)
      const body: AdminCommitmentList = { items: (await commitmentsOf(prisma, id)).map(toAdminCommitment) }
      res.json(body)
    })
    .post('/', requirePermission('commitment.edit'), async (req, res) => {
      const { id } = parse(ProductParams, req.params)
      const input = parse(CommitmentRequest, req.body)
      const created = await audited(prisma, req, async (tx, audit) => {
        await lockProduct(tx, id)
        const documentIds = await assertEvidence(tx, id, input)
        const row = await tx.productCommitment.create({
          data: {
            productId: id,
            typeId: input.typeId,
            statement: input.statement,
            documents: { create: documentIds.map((documentId) => ({ documentId })) },
          },
          include: WITH_TYPE_AND_DOCUMENTS,
        })
        await audit({
          action: 'commitment.create',
          entityType: 'product_commitment',
          entityId: row.id,
          after: auditFields(row),
        })
        return row
      }).catch(rethrowTypeTaken)
      const body: AdminCommitment = toAdminCommitment(created)
      res.status(201).json(body)
    })
    .put('/:commitmentId', requirePermission('commitment.edit'), async (req, res) => {
      const { id, commitmentId } = parse(CommitmentParams, req.params)
      const input = parse(CommitmentRequest, req.body)
      const updated = await audited(prisma, req, async (tx, audit) => {
        await lockProduct(tx, id)
        const before = await findCommitment(tx, id, commitmentId)
        const documentIds = await assertEvidence(tx, id, input)
        if (
          before.typeId === input.typeId &&
          before.statement === input.statement &&
          isDeepStrictEqual(documentIdsOf(before), documentIds)
        ) {
          return before
        }
        const after = await tx.productCommitment.update({
          where: { id: commitmentId },
          data: {
            typeId: input.typeId,
            statement: input.statement,
            documents: { deleteMany: {}, create: documentIds.map((documentId) => ({ documentId })) },
          },
          include: WITH_TYPE_AND_DOCUMENTS,
        })
        await audit({
          action: 'commitment.update',
          entityType: 'product_commitment',
          entityId: commitmentId,
          before: auditFields(before),
          after: auditFields(after),
        })
        return after
      }).catch(rethrowTypeTaken)
      const body: AdminCommitment = toAdminCommitment(updated)
      res.json(body)
    })
    .delete('/:commitmentId', requirePermission('commitment.edit'), async (req, res) => {
      const { id, commitmentId } = parse(CommitmentParams, req.params)
      await audited(prisma, req, async (tx, audit) => {
        await lockProduct(tx, id)
        const commitment = await findCommitment(tx, id, commitmentId)
        await tx.productCommitment.delete({ where: { id: commitmentId } })
        await audit({
          action: 'commitment.delete',
          entityType: 'product_commitment',
          entityId: commitmentId,
          before: auditFields(commitment),
        })
      })
      res.status(204).end()
    })
}

/** Cam kết thuộc đúng sản phẩm trên URL; cam kết của sản phẩm khác coi như không có. */
async function findCommitment(tx: Prisma.TransactionClient, productId: string, commitmentId: string) {
  const commitment = await tx.productCommitment.findUnique({
    where: { id: commitmentId },
    include: WITH_TYPE_AND_DOCUMENTS,
  })
  if (!commitment || commitment.productId !== productId) {
    throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy cam kết')
  }
  return commitment
}
