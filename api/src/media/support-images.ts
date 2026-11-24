import { randomUUID } from 'node:crypto'
import type { Request } from 'express'
import sharp from 'sharp'
import { IMAGE_CONTENT_TYPES, SUPPORT_IMAGE_MAX_BYTES } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { fileError, receiveFile, requiredFile } from './upload.ts'

/** Images with too many pixels ("decompression bombs") are rejected before decoding, as for product images. */
const MAX_INPUT_PIXELS = 50_000_000
/** Longest side after downscaling: enough to see a defect, without keeping originals of tens of MB. */
const MAX_EDGE = 2000

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** Receives one multipart image in field `file`; over 5 MB gives 413. */
export const receiveSupportImage = receiveFile(
  SUPPORT_IMAGE_MAX_BYTES,
  `Ảnh vượt quá ${SUPPORT_IMAGE_MAX_BYTES / 1024 / 1024} MB`,
)

export type StoredSupportImage = { key: string; contentType: string; sizeBytes: number; width: number; height: number }

/**
 * Images attached to support requests by customers or staff (spec M6b). Checks the real type from content, re-encodes
 * in the same format to strip EXIF (GPS, camera), applies the capture rotation, caps the longest side at 2000px, then
 * uploads to the `private` bucket under `support/<request id>/`.
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
    // No `quality` for png: sharp reads it as color reduction.
    .toFormat(meta.format!, meta.format === 'png' ? {} : { quality: 85 })
    .toBuffer({ resolveWithObject: true })
    .catch(() => {
      throw fileError(400, 'Không đọc được nội dung ảnh')
    })
  const key = `support/${requestId}/${randomUUID()}.${EXTENSIONS[contentType]}`
  await storage.put({ bucket: 'private', key, body: data, contentType })
  return { key, contentType, sizeBytes: data.length, width: info.width, height: info.height }
}

/** Deletes the image after the record's transaction rolled back; storage errors are only logged (private orphan). */
export async function deleteSupportImageQuietly(storage: Storage, req: Request, key: string) {
  await storage.delete('private', key).catch((err: unknown) => {
    req.log.warn({ err, key }, 'Không xóa được ảnh đính kèm trên storage')
  })
}
