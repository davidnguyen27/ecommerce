import type { Request, RequestHandler } from 'express'
import multer from 'multer'
import { ErrorCode } from '@ecommerce/shared'
import { AppError } from '../errors.ts'

/** Error on the multipart field `file`. */
export const fileError = (status: number, message: string) =>
  new AppError(status, ErrorCode.VALIDATION_ERROR, message, [{ path: 'file', message }])

/** Receives one multipart file in field `file` into memory; over `maxBytes` gives 413 with `tooLargeMessage`. */
export function receiveFile(maxBytes: number, tooLargeMessage: string): RequestHandler {
  const parseSingleFile = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 10, fieldSize: 10_000 },
    // Vietnamese file names from browsers are UTF-8.
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

/** The file received via `receiveFile`; missing gives 400 with `missingMessage`. */
export function requiredFile(req: Request, missingMessage: string): Express.Multer.File {
  if (!req.file) throw fileError(400, missingMessage)
  return req.file
}
