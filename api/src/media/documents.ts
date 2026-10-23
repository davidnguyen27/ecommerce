import type { Request } from 'express'
import { MAX_DOCUMENT_BYTES } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { fileError, receiveFile, requiredFile } from './upload.ts'

/** URL ký tới chứng từ sống 5 phút: đủ để mở, hết hạn trước khi link kịp bị chuyển tiếp lung tung. */
export const DOCUMENT_URL_TTL_SECONDS = 300

export const receiveDocument = receiveFile(
  MAX_DOCUMENT_BYTES,
  `Chứng từ vượt quá ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB`,
)

const startsWith = (file: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => file[offset + i] === b)
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

/** MIME type thật đọc từ chữ ký đầu file (không tin đuôi hay Content-Type); không thuộc loại nhận thì `null`. */
export function detectDocumentType(file: Buffer): string | null {
  if (startsWith(file, ascii('%PDF-'))) return 'application/pdf'
  if (startsWith(file, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(file, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(file, ascii('RIFF')) && startsWith(file, ascii('WEBP'), 8)) return 'image/webp'
  return null
}

/** Chứng từ đã nhận qua `receiveDocument`, đã kiểm loại thật. */
export function uploadedDocument(req: Request) {
  const file = requiredFile(req, 'Chưa chọn file chứng từ')
  const contentType = detectDocumentType(file.buffer)
  if (!contentType) throw fileError(400, 'Chứng từ phải là file pdf, jpeg, png hoặc webp')
  return { body: file.buffer, contentType, fileName: cleanFileName(file.originalname) }
}

/** Tên file chỉ để hiển thị trong admin: bỏ đường dẫn và ký tự điều khiển. */
function cleanFileName(name: string) {
  // eslint-disable-next-line no-control-regex
  const base = (name.split(/[/\\]/).pop() ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return base.slice(0, 200) || 'chung-tu'
}

/** Xóa file sau khi DB đã commit hoặc rollback; lỗi storage chỉ ghi log (file mồ côi trên bucket private). */
export async function deleteDocumentFileQuietly(storage: Storage, req: Request, key: string) {
  await storage.delete('private', key).catch((err: unknown) => {
    req.log.warn({ err, key }, 'Không xóa được file chứng từ trên storage')
  })
}
