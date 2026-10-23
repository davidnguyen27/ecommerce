import { z } from 'zod'

/** Chứng từ nhận pdf và ảnh; MIME type đọc từ nội dung file, không theo đuôi. */
export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const

/** Dung lượng tối đa của một chứng từ tải lên (bản scan nhiều trang). */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

/** Chứng từ nguồn hàng nội bộ; chỉ có metadata, file mở qua URL ký. */
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

/** URL ký có hạn tới file chứng từ trên bucket private; mỗi lần cấp đều ghi audit. */
export const DocumentUrl = z.object({ url: z.string(), expiresAt: z.string() })
export type DocumentUrl = z.infer<typeof DocumentUrl>

/** `warranty`: loại cam kết là bảo hành; bảo hành chỉ hiện với khách qua loại này (ADR 0005). */
export const CommitmentKind = z.enum(['warranty', 'other'])
export type CommitmentKind = z.infer<typeof CommitmentKind>

export const CommitmentType = z.object({ id: z.string(), name: z.string(), kind: CommitmentKind })
export type CommitmentType = z.infer<typeof CommitmentType>

export const CommitmentTypeList = z.object({ items: z.array(CommitmentType) })
export type CommitmentTypeList = z.infer<typeof CommitmentTypeList>

export const CommitmentTypeRequest = z.object({ name: z.string().trim().min(1).max(200), kind: CommitmentKind })
export type CommitmentTypeRequest = z.infer<typeof CommitmentTypeRequest>

/** Cam kết có bằng chứng của một sản phẩm, như nhân viên thấy. */
export const AdminCommitment = z.object({
  id: z.string(),
  typeId: z.string(),
  typeName: z.string(),
  kind: CommitmentKind,
  /** Nội dung hiển thị cho khách. */
  statement: z.string(),
  /** Chứng từ của chính sản phẩm này làm bằng chứng; luôn có ít nhất một. */
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

/** Cam kết có bằng chứng như khách thấy: không có chứng từ hay URL của chứng từ. */
export const PublicCommitment = z.object({
  /** Tên loại cam kết, ví dụ "Bảo hành chính hãng". */
  type: z.string(),
  kind: CommitmentKind,
  statement: z.string(),
})
export type PublicCommitment = z.infer<typeof PublicCommitment>
