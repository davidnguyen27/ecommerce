import type { Request } from 'express'
import type { Logger } from 'pino'
import sharp from 'sharp'
import { z } from 'zod'
import { IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, type ImageRenditions } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { fileError, receiveFile, requiredFile } from './upload.ts'

/** Prebuilt webp widths for product images: phone product cards up to the large detail image. */
export const PRODUCT_IMAGE_WIDTHS = [320, 640, 1024, 1600]

/** Prebuilt webp widths for brand logos. */
export const LOGO_WIDTHS = [160, 320]

/** Images with too many pixels ("decompression bombs") are rejected instead of decoded. */
const MAX_INPUT_PIXELS = 50_000_000

/** An image stored in the public bucket under prefix `key`. */
export const StoredImage = z.object({
  key: z.string(),
  contentType: z.string(),
  width: z.number(),
  height: z.number(),
  widths: z.array(z.number()),
})
export type StoredImage = z.infer<typeof StoredImage>

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const originalKey = (image: Pick<StoredImage, 'key' | 'contentType'>) =>
  `${image.key}/original.${EXTENSIONS[image.contentType]}`
const sizeKey = (key: string, width: number) => `${key}/w${width}.webp`

/** Receives one multipart file in field `file` into memory; too large gives 413. */
export const receiveImage = receiveFile(MAX_IMAGE_BYTES, `Ảnh vượt quá ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)

/** The file received via `receiveImage`; missing gives 400. */
export function uploadedFile(req: Request): Buffer {
  return requiredFile(req, 'Chưa chọn file ảnh').buffer
}

/**
 * Checks the real image type from content (not the extension or Content-Type), keeps the original, builds the webp
 * widths and uploads everything to the public bucket under prefix `key`.
 */
export async function storeImage(storage: Storage, key: string, file: Buffer, widths: number[]): Promise<StoredImage> {
  const meta = await sharp(file, { limitInputPixels: MAX_INPUT_PIXELS })
    .metadata()
    .catch(() => null)
  const contentType = meta?.format && `image/${meta.format}`
  if (!meta || !contentType || !(IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw fileError(400, 'File không phải ảnh jpeg, png hoặc webp')
  }
  const { width, height } = meta.autoOrient
  const image: StoredImage = { key, contentType, width, height, widths }

  const oriented = () => sharp(file, { limitInputPixels: MAX_INPUT_PIXELS }).autoOrient()
  const [original, ...sizes] = await Promise.all([
    // The original is public: re-encode in the same format to strip EXIF (GPS, camera) and apply the capture rotation.
    // No `quality` for png: sharp reads it as color reduction.
    oriented()
      .toFormat(meta.format!, meta.format === 'png' ? {} : { quality: 90 })
      .toBuffer(),
    ...widths.map((w) => oriented().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()),
  ]).catch(() => {
    throw fileError(400, 'Không đọc được nội dung ảnh')
  })

  const objects = [
    { key: originalKey(image), body: original!, contentType },
    ...widths.map((w, i) => ({ key: sizeKey(key, w), body: sizes[i]!, contentType: 'image/webp' })),
  ]
  try {
    await Promise.all(objects.map((object) => storage.put({ bucket: 'public', ...object })))
  } catch (err) {
    await deleteImageFiles(storage, image)
    throw err
  }
  return image
}

/** Deletes the original and every width of the image from storage. */
export async function deleteImageFiles(storage: Storage, image: StoredImage) {
  await Promise.all(
    [originalKey(image), ...image.widths.map((w) => sizeKey(image.key, w))].map((key) => storage.delete('public', key)),
  )
}

/**
 * Deletes files after the DB commit or rollback. Storage errors are only logged: the data is right, and leftover public
 * files are referenced by nothing.
 */
/** Deletes an image's files; a storage error is only logged (`req` or a service's `{ log }`). */
export async function deleteImageFilesQuietly(
  storage: Storage,
  req: { log: Pick<Logger, 'warn'> },
  image: StoredImage,
) {
  await deleteImageFiles(storage, image).catch((err: unknown) => {
    req.log.warn({ err, key: image.key }, 'Không xóa được file ảnh trên storage')
  })
}

export function imageRenditions(storage: Storage, image: StoredImage): ImageRenditions {
  return {
    originalUrl: storage.publicUrl(originalKey(image)),
    width: image.width,
    height: image.height,
    sizes: image.widths.map((width) => ({ width, url: storage.publicUrl(sizeKey(image.key, width)) })),
  }
}
