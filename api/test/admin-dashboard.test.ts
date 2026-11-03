import { describe, expect, it } from 'vitest'
import { shop } from './support/shop.ts'
import { bearer, createStaff } from './support/staff.ts'

const TOTAL = 2_030_000

/**
 * Bảng điều khiển đọc hai số đếm bằng chính API danh sách với `pageSize=1` rồi lấy `total`:
 * hàng chờ soạn (mặc định của `/api/admin/orders`) và mục cần đối soát (mặc định `open`).
 */
const COUNTS = ['/api/admin/orders', '/api/admin/reconciliation'] as const

describe('số đếm ở bảng điều khiển', () => {
  it('đếm đơn chờ soạn và mục cần đối soát còn mở, đọc được với order.view', async () => {
    const { request, token, checkout } = await shop({ simulator: true })
    const sales = await createStaff(request, token, ['sales'], 'ban-hang@example.com')
    const order = async () => {
      const res = await checkout()
      expect(res.status).toBe(201)
      return res.body as { code: number; token: string }
    }
    const pay = async (code: number, amount = TOTAL) => {
      const res = await request.post('/api/payments/simulator/paid').send({ orderCode: code, amount })
      expect(res.status).toBe(204)
    }

    // Kho có 3 đôi AM-40: hủy đơn trước để trả lại chỗ giữ hàng.
    const cancelled = await order()
    const cancel = await request.post(`/api/orders/${cancelled.code}/cancel`).query({ token: cancelled.token })
    expect(cancel.status).toBe(200)
    const first = await order()
    const second = await order()
    await order()
    await pay(first.code)
    await pay(second.code)
    await pay(cancelled.code)

    const [orders, reconciliation] = await Promise.all(
      COUNTS.map((path) => request.get(path).query({ pageSize: 1 }).set(bearer(sales.accessToken))),
    )

    expect(orders!.status).toBe(200)
    expect(orders!.body).toMatchObject({ total: 2, pageSize: 1 })
    expect(orders!.body.items).toHaveLength(1)
    expect(reconciliation!.status).toBe(200)
    expect(reconciliation!.body).toMatchObject({ total: 1, pageSize: 1 })
  })

  it('thiếu order.view thì 403', async () => {
    const { request, token, prisma } = await shop({ simulator: true })
    const staff = await createStaff(request, token, ['sales'], 'khong-quyen@example.com')
    // Mọi vai trò hiện có đều có order.view; nhân viên chưa được gán vai trò nào thì không có.
    await prisma.staff.update({ where: { id: staff.id }, data: { roles: [] } })

    for (const path of COUNTS) {
      const res = await request.get(path).query({ pageSize: 1 }).set(bearer(staff.accessToken))
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    }
  })
})
