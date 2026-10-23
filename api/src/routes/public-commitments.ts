import { Router } from 'express'
import { z } from 'zod'
import { ErrorCode, type PublicCommitmentList } from '@ecommerce/shared'
import { publicCommitments } from '../catalog/commitments.ts'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

const SlugParams = z.object({ slug: z.string() })

/**
 * Cam kết có bằng chứng của một sản phẩm đã xuất bản, mount tại `/products/:slug/commitments`.
 * Không trả chứng từ hay URL của chứng từ. Sản phẩm nháp hoặc lưu trữ coi như không có.
 */
export function publicCommitmentRoutes(prisma: Db) {
  return Router({ mergeParams: true }).get('/', async (req, res) => {
    const { slug } = parse(SlugParams, req.params)
    const product = await prisma.product.findUnique({ where: { slug }, select: { id: true, status: true } })
    if (!product || product.status !== 'published') {
      throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy sản phẩm')
    }
    const body: PublicCommitmentList = { items: await publicCommitments(prisma, product.id) }
    res.json(body)
  })
}
