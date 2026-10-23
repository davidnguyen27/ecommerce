import type { Request, RequestHandler } from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { z } from 'zod'
import { ErrorCode, IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, type ImageRenditions } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import { AppError } from '../http/errors.ts'

/** Cỡ webp sinh sẵn cho ảnh sản phẩm: thẻ sản phẩm trên điện thoại tới ảnh lớn ở trang chi tiết. */
export const PRODUCT_IMAGE_WIDTHS = [320, 640, 1024, 1600]

/** Cỡ webp sinh sẵn cho logo thương hiệu. */
export const LOGO_WIDTHS = [160, 320]

/** Ảnh quá lớn về số điểm ảnh (ảnh "bom giải nén") thì từ chối thay vì giải mã. */
const MAX_INPUT_PIXELS = 50_000_000

/** Ảnh đã lưu trên bucket public, dưới tiền tố `key`. */
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

const fileError = (status: number, message: string) =>
  new AppError(status, ErrorCode.VALIDATION_ERROR, message, [{ path: 'file', message }])

const parseSingleFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10, fieldSize: 10_000 },
}).single('file')

/** Nhận một file multipart ở trường `file` vào bộ nhớ; quá dung lượng thì 413. */
export const receiveImage: RequestHandler = (req, res, next) => {
  parseSingleFile(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(
        err.code === 'LIMIT_FILE_SIZE'
          ? fileError(413, `Ảnh vượt quá ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
          : fileError(400, 'Mỗi lần chỉ tải một file ở trường "file"'),
      )
    }
    next(err)
  })
}

/** File đã nhận qua `receiveImage`; thiếu thì 400. */
export function uploadedFile(req: Request): Buffer {
  if (!req.file) throw fileError(400, 'Chưa chọn file ảnh')
  return req.file.buffer
}

/**
 * Kiểm loại ảnh thật từ nội dung file (không tin đuôi hay Content-Type), giữ bản gốc,
 * sinh các cỡ webp rồi đưa tất cả lên bucket public dưới tiền tố `key`.
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

  const sizes = await Promise.all(
    widths.map((w) =>
      sharp(file, { limitInputPixels: MAX_INPUT_PIXELS })
        .autoOrient()
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer(),
    ),
  ).catch(() => {
    throw fileError(400, 'Không đọc được nội dung ảnh')
  })

  const objects = [
    { key: originalKey(image), body: file, contentType },
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

/** Xóa bản gốc và mọi cỡ của ảnh trên storage. */
export async function deleteImageFiles(storage: Storage, image: StoredImage) {
  await Promise.all(
    [originalKey(image), ...image.widths.map((w) => sizeKey(image.key, w))].map((key) => storage.delete('public', key)),
  )
}

/**
 * Xóa file sau khi DB đã commit hoặc rollback. Lỗi storage chỉ ghi log: dữ liệu đã đúng,
 * file sót lại trên bucket public không ai tham chiếu tới.
 */
export async function deleteImageFilesQuietly(storage: Storage, req: Request, image: StoredImage) {
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
