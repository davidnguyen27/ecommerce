import { isDeepStrictEqual } from 'node:util'
import type { CommitmentRequest } from '@ecommerce/shared'
import { audited } from '../../core/audit/audited.ts'
import type { RequestContext } from '../../core/context/request-context.ts'
import type { Db } from '../../core/db.ts'
import { invalidField, rethrowUnique } from '../../core/errors.ts'
import type { Prisma } from '../../generated/prisma/client.ts'
import { commitmentNotFound, commitmentTypeTaken } from './product.constant.ts'
import { commitmentAuditFields, documentIdsOf } from './product.mapper.ts'
import type { ProductRepository } from './product.repository.ts'
import type { ProductService } from './product.service.ts'

/**
 * Evidenced commitments of a product. Writes lock the product row, the same lock as document deletion, so documents
 * cannot be deleted between the evidence check and the write.
 */
export class ProductCommitmentService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: ProductRepository,
    private readonly products: ProductService,
  ) {}

  async list(productId: string) {
    await this.products.load(this.prisma, productId)
    return this.repo.commitments(this.prisma, productId)
  }

  /** A commitment of exactly the product in the URL; another product's counts as missing. */
  private async find(tx: Prisma.TransactionClient, productId: string, commitmentId: string) {
    const commitment = await this.repo.findCommitment(tx, commitmentId)
    if (!commitment || commitment.productId !== productId) throw commitmentNotFound()
    return commitment
  }

  /** Checks the type exists and every document belongs to the product; returns the deduplicated documents. */
  private async assertEvidence(tx: Prisma.TransactionClient, productId: string, input: CommitmentRequest) {
    if (!(await this.repo.findCommitmentType(tx, input.typeId))) {
      throw invalidField('typeId', 'Loại cam kết không có trong danh sách')
    }
    const own = await this.repo.ownDocumentIds(tx, productId, input.documentIds)
    const ownIds = new Set(own.map((d) => d.id))
    const foreign = input.documentIds.findIndex((id) => !ownIds.has(id))
    if (foreign !== -1)
      throw invalidField(`documentIds.${foreign}`, 'Chỉ dựa được trên chứng từ của chính sản phẩm này')
    return [...ownIds].sort()
  }

  async create(productId: string, input: CommitmentRequest, ctx: RequestContext) {
    return audited(this.prisma, ctx, async (tx, audit) => {
      await this.products.lock(tx, productId)
      const documentIds = await this.assertEvidence(tx, productId, input)
      const row = await this.repo.createCommitment(tx, {
        productId,
        typeId: input.typeId,
        statement: input.statement,
        documents: { create: documentIds.map((documentId) => ({ documentId })) },
      })
      await audit({
        action: 'commitment.create',
        entityType: 'product_commitment',
        entityId: row.id,
        after: commitmentAuditFields(row),
      })
      return row
    }).catch(rethrowUnique(commitmentTypeTaken))
  }

  /** The same type, statement and documents write nothing. */
  async update(productId: string, commitmentId: string, input: CommitmentRequest, ctx: RequestContext) {
    return audited(this.prisma, ctx, async (tx, audit) => {
      await this.products.lock(tx, productId)
      const before = await this.find(tx, productId, commitmentId)
      const documentIds = await this.assertEvidence(tx, productId, input)
      if (
        before.typeId === input.typeId &&
        before.statement === input.statement &&
        isDeepStrictEqual(documentIdsOf(before), documentIds)
      ) {
        return before
      }
      const after = await this.repo.updateCommitment(tx, commitmentId, {
        typeId: input.typeId,
        statement: input.statement,
        documents: { deleteMany: {}, create: documentIds.map((documentId) => ({ documentId })) },
      })
      await audit({
        action: 'commitment.update',
        entityType: 'product_commitment',
        entityId: commitmentId,
        before: commitmentAuditFields(before),
        after: commitmentAuditFields(after),
      })
      return after
    }).catch(rethrowUnique(commitmentTypeTaken))
  }

  async delete(productId: string, commitmentId: string, ctx: RequestContext) {
    await audited(this.prisma, ctx, async (tx, audit) => {
      await this.products.lock(tx, productId)
      const commitment = await this.find(tx, productId, commitmentId)
      await this.repo.deleteCommitment(tx, commitmentId)
      await audit({
        action: 'commitment.delete',
        entityType: 'product_commitment',
        entityId: commitmentId,
        before: commitmentAuditFields(commitment),
      })
    })
  }
}
