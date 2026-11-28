import type { AdminCommitment, PublicCommitment } from '@ecommerce/shared'
import type { DbClient } from '../core/db.ts'
import type { CommitmentType, Prisma, ProductCommitment } from '../generated/prisma/client.ts'

export const WITH_TYPE_AND_DOCUMENTS = {
  type: true,
  documents: { select: { documentId: true }, orderBy: { documentId: 'asc' } },
} as const

export type CommitmentWithEvidence = ProductCommitment & { type: CommitmentType; documents: { documentId: string }[] }

const ORDER = [{ type: { name: 'asc' } }, { createdAt: 'asc' }] as const

/** A product's commitments with type and documents, sorted by type name. */
export const commitmentsOf = (db: DbClient, productId: string) =>
  db.productCommitment.findMany({ where: { productId }, include: WITH_TYPE_AND_DOCUMENTS, orderBy: [...ORDER] })

export const documentIdsOf = (commitment: CommitmentWithEvidence) => commitment.documents.map((d) => d.documentId)

export function toAdminCommitment(commitment: CommitmentWithEvidence): AdminCommitment {
  return {
    id: commitment.id,
    typeId: commitment.typeId,
    typeName: commitment.type.name,
    kind: commitment.type.kind,
    statement: commitment.statement,
    documentIds: documentIdsOf(commitment),
  }
}

/** A product's commitments in display order, with type; used to build the publish snapshot. */
export const COMMITMENTS_WITH_TYPE = {
  include: { type: true },
  orderBy: [...ORDER],
} satisfies Prisma.ProductCommitmentFindManyArgs

/**
 * Evidenced commitments as customers see them: type and content, never documents. Copied into the snapshot on
 * publish; warranty appears only here, as a commitment with `kind: 'warranty'` (ADR 0005).
 */
export const toPublicCommitment = (c: ProductCommitment & { type: CommitmentType }): PublicCommitment => ({
  type: c.type.name,
  kind: c.type.kind,
  statement: c.statement,
})
