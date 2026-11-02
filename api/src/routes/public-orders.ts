import { Router } from 'express'
import type { PublicOrder } from '@ecommerce/shared'
import type { Storage } from '../adapters/storage.ts'
import type { Db } from '../db.ts'
import { findOrderByToken, toPublicOrder } from '../orders/orders.ts'

/** Đơn hàng qua link có token tra cứu, không cần đăng nhập. */
export function publicOrderRoutes(prisma: Db, storage: Storage) {
  return Router().get('/:code', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : undefined
    const order = await findOrderByToken(prisma, String(req.params.code), token)
    const body: PublicOrder = toPublicOrder(storage, order)
    // Dữ liệu cá nhân: không để proxy hay trình duyệt lưu lại.
    res.set('Cache-Control', 'no-store').json(body)
  })
}
