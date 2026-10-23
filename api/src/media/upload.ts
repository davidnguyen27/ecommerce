import type { Request, RequestHandler } from 'express'
import multer from 'multer'
import { ErrorCode } from '@ecommerce/shared'
import { AppError } from '../http/errors.ts'

/** Lỗi trên trường multipart `file`. */
export const fileError = (status: number, message: string) =>
  new AppError(status, ErrorCode.VALIDATION_ERROR, message, [{ path: 'file', message }])

/** Nhận một file multipart ở trường `file` vào bộ nhớ; quá `maxBytes` thì 413 với `tooLargeMessage`. */
export function receiveFile(maxBytes: number, tooLargeMessage: string): RequestHandler {
  const parseSingleFile = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 10, fieldSize: 10_000 },
    // Tên file tiếng Việt gửi từ trình duyệt là UTF-8.
    defParamCharset: 'utf8',
  }).single('file')

  return (req, res, next) => {
    parseSingleFile(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        return next(
          err.code === 'LIMIT_FILE_SIZE'
            ? fileError(413, tooLargeMessage)
            : fileError(400, 'Mỗi lần chỉ tải một file ở trường "file"'),
        )
      }
      next(err)
    })
  }
}

/** File đã nhận qua `receiveFile`; thiếu thì 400 với `missingMessage`. */
export function requiredFile(req: Request, missingMessage: string): Express.Multer.File {
  if (!req.file) throw fileError(400, missingMessage)
  return req.file
}
