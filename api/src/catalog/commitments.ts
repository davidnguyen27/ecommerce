import type { AdminCommitment, PublicCommitment } from '@ecommerce/shared'
import type { DbClient } from '../db.ts'
import type { CommitmentType, ProductCommitment } from '../generated/prisma/client.ts'

export const WITH_TYPE_AND_DOCUMENTS = {
  type: true,
  documents: { select: { documentId: true }, orderBy: { documentId: 'asc' } },
} as const

export type CommitmentWithEvidence = ProductCommitment & { type: CommitmentType; documents: { documentId: string }[] }

const ORDER = [{ type: { name: 'asc' } }, { createdAt: 'asc' }] as const

/** Cam kết của một sản phẩm kèm loại và chứng từ, xếp theo tên loại. */
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

/**
 * Cam kết có bằng chứng như khách thấy: loại và nội dung, không bao giờ kèm chứng từ.
 * Trang chi tiết sản phẩm (ticket 11) gọi hàm này để hiển thị cam kết tách khỏi thông tin công bố;
 * bảo hành chỉ xuất hiện ở đây, dưới dạng cam kết có `kind: 'warranty'` (ADR 0005).
 */
export async function publicCommitments(db: DbClient, productId: string): Promise<PublicCommitment[]> {
  const commitments = await db.productCommitment.findMany({
    where: { productId },
    include: { type: true },
    orderBy: [...ORDER],
  })
  return commitments.map((c) => ({ type: c.type.name, kind: c.type.kind, statement: c.statement }))
}
