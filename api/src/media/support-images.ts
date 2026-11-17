import { randomUUID } from 'node:crypto'
import type { Request } from 'express'
import sharp from 'sharp'
import { IMAGE_CONTENT_TYPES, SUPPORT_IMAGE_MAX_BYTES } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { fileError, receiveFile, requiredFile } from './upload.ts'

/** Ảnh quá lớn về số điểm ảnh ("bom giải nén") thì từ chối trước khi giải mã, như ảnh sản phẩm. */
const MAX_INPUT_PIXELS = 50_000_000
/** Cạnh dài nhất sau khi thu nhỏ: đủ xem rõ lỗi trên hàng, không giữ ảnh gốc hàng chục MB. */
const MAX_EDGE = 2000

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Nhận một ảnh multipart ở trường `file`; quá 5 MB thì 413. */
export const receiveSupportImage = receiveFile(
  SUPPORT_IMAGE_MAX_BYTES,
  `Ảnh vượt quá ${SUPPORT_IMAGE_MAX_BYTES / 1024 / 1024} MB`,
)

export type StoredSupportImage = { key: string; contentType: string; sizeBytes: number; width: number; height: number }

/**
 * Ảnh khách hay nhân viên gửi kèm yêu cầu hỗ trợ (spec M6b). Kiểm loại thật từ nội dung file (không tin đuôi hay
 * Content-Type), mã hóa lại cùng định dạng để bỏ EXIF (vị trí GPS, máy chụp), xoay theo chiều chụp, thu cạnh dài về
 * tối đa 2000px, rồi đưa lên bucket `private` dưới `support/<id yêu cầu>/`.
 */
export async function storeSupportImage(
  storage: Storage,
  req: Request,
  requestId: string,
): Promise<StoredSupportImage> {
  const file = requiredFile(req, 'Chưa chọn file ảnh').buffer
  const meta = await sharp(file, { limitInputPixels: MAX_INPUT_PIXELS })
    .metadata()
    .catch(() => null)
  const contentType = meta?.format && `image/${meta.format}`
  if (!meta || !contentType || !(IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw fileError(400, 'File không phải ảnh jpeg, png hoặc webp')
  }
  const { data, info } = await sharp(file, { limitInputPixels: MAX_INPUT_PIXELS })
    .autoOrient()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    // png không truyền `quality`: với png, sharp hiểu đó là giảm số màu.
    .toFormat(meta.format!, meta.format === 'png' ? {} : { quality: 85 })
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw fileError(400, 'Không đọc được nội dung ảnh')
    })
  const key = `support/${requestId}/${randomUUID()}.${EXTENSIONS[contentType]}`
  await storage.put({ bucket: 'private', key, body: data, contentType })
  return { key, contentType, sizeBytes: data.length, width: info.width, height: info.height }
}

/** Xóa ảnh sau khi transaction ghi bản ghi bị rollback; lỗi storage chỉ ghi log (file mồ côi trên bucket private). */
export async function deleteSupportImageQuietly(storage: Storage, req: Request, key: string) {
  await storage.delete('private', key).catch((err: unknown) => {
    req.log.warn({ err, key }, 'Không xóa được ảnh đính kèm trên storage')
  })
}
