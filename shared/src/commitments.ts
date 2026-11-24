import { z } from 'zod'

/** Documents accept pdf and images; the MIME type comes from content, not the extension. */
export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const

/** Max size of an uploaded document (multi-page scans). */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

/** Internal supplier document; metadata only, the file opens via a signed URL. */
export const AdminProductDocument = z.object({
  id: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  createdAt: z.string(),
})
export type AdminProductDocument = z.infer<typeof AdminProductDocument>

export const AdminProductDocumentList = z.object({ items: z.array(AdminProductDocument) })
export type AdminProductDocumentList = z.infer<typeof AdminProductDocumentList>

/** Expiring signed URL to the document in the private bucket; each one issued is audited. */
export const DocumentUrl = z.object({ url: z.string(), expiresAt: z.string() })
export type DocumentUrl = z.infer<typeof DocumentUrl>

/** `warranty`: the commitment type is a warranty; warranty reaches customers only through it (ADR 0005). */
export const CommitmentKind = z.enum(['warranty', 'other'])
export type CommitmentKind = z.infer<typeof CommitmentKind>

export const CommitmentType = z.object({ id: z.string(), name: z.string(), kind: CommitmentKind })
export type CommitmentType = z.infer<typeof CommitmentType>

export const CommitmentTypeList = z.object({ items: z.array(CommitmentType) })
export type CommitmentTypeList = z.infer<typeof CommitmentTypeList>

export const CommitmentTypeRequest = z.object({ name: z.string().trim().min(1).max(200), kind: CommitmentKind })
export type CommitmentTypeRequest = z.infer<typeof CommitmentTypeRequest>

/** A product's evidenced commitment, as staff see it. */
export const AdminCommitment = z.object({
  id: z.string(),
  typeId: z.string(),
  typeName: z.string(),
  kind: CommitmentKind,
  /** Text shown to customers. */
  statement: z.string(),
  /** Documents of this same product as evidence; always at least one. */
  documentIds: z.array(z.string()),
})
export type AdminCommitment = z.infer<typeof AdminCommitment>

export const AdminCommitmentList = z.object({ items: z.array(AdminCommitment) })
export type AdminCommitmentList = z.infer<typeof AdminCommitmentList>

export const CommitmentRequest = z.object({
  typeId: z.uuid(),
  statement: z.string().trim().min(1).max(2000),
  documentIds: z.array(z.uuid()).min(1, 'Cam kết cần dựa trên ít nhất một chứng từ').max(50),
})
export type CommitmentRequest = z.infer<typeof CommitmentRequest>

/** An evidenced commitment as customers see it: no documents or document URLs. */
export const PublicCommitment = z.object({
  /** Commitment type name, e.g. "Bảo hành chính hãng". */
  type: z.string(),
  kind: CommitmentKind,
  statement: z.string(),
})
export type PublicCommitment = z.infer<typeof PublicCommitment>
