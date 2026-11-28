import { isDeepStrictEqual } from 'node:util'
import { Router } from 'express'
import { z } from 'zod'
import { CommitmentRequest, ErrorCode, type AdminCommitment, type AdminCommitmentList } from '@ecommerce/shared'
import { audited } from '../core/audit/audited.ts'
import { requirePermission } from '../core/middleware/staff-context.ts'
import {
  WITH_TYPE_AND_DOCUMENTS,
  commitmentsOf,
  documentIdsOf,
  toAdminCommitment,
  type CommitmentWithEvidence,
} from '../catalog/commitments.ts'
import { ProductParams, loadProduct, lockProduct } from '../catalog/products.ts'
import type { Db } from '../core/db.ts'
import { Prisma } from '../generated/prisma/client.ts'
import { AppError, conflictField, invalidField, rethrowUnique } from '../core/errors.ts'
import { parse } from '../core/middleware/validation.ts'
import { contextOf } from '../core/context/request-context.ts'

const CommitmentParams = z.object({ id: z.uuid(), commitmentId: z.uuid() })

/** Commitment business fields recorded in audit. */
function auditFields(commitment: CommitmentWithEvidence) {
  const { productId, typeId, statement } = commitment
  return { productId, typeId, statement, documentIds: documentIdsOf(commitment) }
}

const typeTaken = () => conflictField('typeId', 'Sản phẩm đã có cam kết thuộc loại này')

/**
 * Checks the commitment type exists and every document belongs to the product; returns the deduplicated documents.
 * Runs after `lockProduct`, so documents cannot be deleted between check and write.
 */
async function assertEvidence(tx: Prisma.TransactionClient, productId: string, input: CommitmentRequest) {
  if (!(await tx.commitmentType.findUnique({ where: { id: input.typeId } }))) {
    throw invalidField('typeId', 'Loại cam kết không có trong danh sách')
  }
  const own = await tx.productDocument.findMany({
    where: { productId, id: { in: input.documentIds } },
    select: { id: true },
  })
  const ownIds = new Set(own.map((d) => d.id))
  const foreign = input.documentIds.findIndex((id) => !ownIds.has(id))
  if (foreign !== -1) throw invalidField(`documentIds.${foreign}`, 'Chỉ dựa được trên chứng từ của chính sản phẩm này')
  return [...ownIds].sort()
}

/**
 * Evidenced commitments of a product, mounted at `/products/:id/commitments`. Anyone editing products can view;
 * create, edit, remove need `commitment.edit`. Writes lock the product row, the same lock as document deletion.
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
      const created = await audited(prisma, contextOf(req), async (tx, audit) => {
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
      }).catch(rethrowUnique(typeTaken))
      const body: AdminCommitment = toAdminCommitment(created)
      res.status(201).json(body)
    })
    .put('/:commitmentId', requirePermission('commitment.edit'), async (req, res) => {
      const { id, commitmentId } = parse(CommitmentParams, req.params)
      const input = parse(CommitmentRequest, req.body)
      const updated = await audited(prisma, contextOf(req), async (tx, audit) => {
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
      }).catch(rethrowUnique(typeTaken))
      const body: AdminCommitment = toAdminCommitment(updated)
      res.json(body)
    })
    .delete('/:commitmentId', requirePermission('commitment.edit'), async (req, res) => {
      const { id, commitmentId } = parse(CommitmentParams, req.params)
      await audited(prisma, contextOf(req), async (tx, audit) => {
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

/** A commitment of exactly the product in the URL; another product's counts as missing. */
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
