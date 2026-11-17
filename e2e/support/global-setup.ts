// Bổ sung dữ liệu mà seed của smoke không có nhưng luồng mua hàng cần. Chạy lại trên cùng stack vẫn được:
// bước nào đã có thì bỏ qua.
import { PREORDER_POLICY_SLUG, PRIVACY_POLICY_SLUG } from '@ecommerce/shared'
import { resetRateLimits } from './rate-limit.ts'
import { ACCOUNTANT, AdminApi, BASE_URL, PROVINCE_CODE, SALES, SHIPPING_FEE, SKU, WAREHOUSE } from './stack.ts'

export default async function globalSetup() {
  const health = await fetch(`${BASE_URL}/healthz`).catch(() => null)
  if (!health?.ok) throw new Error(`Không thấy stack ở ${BASE_URL}; dựng bằng: pnpm smoke --keep`)
  // Chạy lại trên cùng stack không vướng giới hạn đặt mua của lượt trước.
  resetRateLimits()
  const api = await AdminApi.owner()

  // Chưa cấu hình phí giao thì cửa hàng chưa nhận đơn. Tỉnh khác dùng mức mặc định cao hơn để thấy phí theo tỉnh.
  await api.send('PUT', '/api/admin/shipping-fees', {
    defaultFee: SHIPPING_FEE + 20_000,
    freeShippingThreshold: null,
    provinceFees: [{ provinceCode: PROVINCE_CODE, fee: SHIPPING_FEE }],
  })

  // Khách vãng lai phải đồng ý chính sách bảo mật đã xuất bản thì mới đặt được; đặt trước cần thêm chính sách đặt
  // trước đã xuất bản.
  const pages = (await api.pages()).items
  for (const policy of [
    { slug: PRIVACY_POLICY_SLUG, title: 'Chính sách bảo mật', body: 'Dữ liệu dùng để giao hàng.' },
    { slug: PREORDER_POLICY_SLUG, title: 'Chính sách đặt trước', body: 'Cọc giữ suất; trả phần còn lại khi hàng về.' },
  ]) {
    const page = pages.find((p) => p.slug === policy.slug) ?? (await api.createPage({ ...policy, kind: 'policy' }))
    if (page.status !== 'published') await api.send('POST', `/api/admin/pages/${page.id}/publish`)
  }

  const staff = (await api.staff()).items
  for (const [member, role] of [
    [WAREHOUSE, 'warehouse'],
    [SALES, 'sales'],
    [ACCOUNTANT, 'accountant'],
  ] as const) {
    if (!staff.some((s) => s.email === member.email)) {
      await api.send('POST', '/api/admin/staff', { ...member, roles: [role] })
    }
  }

  // Mỗi lượt bán một cái; còn ít hơn một cái có thể bán (chạy lại nhiều lần) thì kiểm kê lên lại.
  const stock = await api.stockOf(SKU)
  if (stock.onHand - stock.reserved < 1) {
    await api.send('POST', '/api/admin/stock/adjustments', {
      variantId: stock.variantId,
      reason: 'stocktake',
      countedQuantity: stock.reserved + 3,
      expectedOnHand: stock.onHand,
      note: 'E2E: bổ sung hàng để chạy lại',
    })
  }
}
