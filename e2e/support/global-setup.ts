// Bổ sung dữ liệu mà seed của smoke không có nhưng luồng mua hàng cần. Chạy lại trên cùng stack vẫn được:
// bước nào đã có thì bỏ qua.
import { PRIVACY_POLICY_SLUG } from '@ecommerce/shared'
import { AdminApi, BASE_URL, PROVINCE_CODE, SHIPPING_FEE, SKU, WAREHOUSE } from './stack.ts'

export default async function globalSetup() {
  const health = await fetch(`${BASE_URL}/healthz`).catch(() => null)
  if (!health?.ok) throw new Error(`Không thấy stack ở ${BASE_URL}; dựng bằng: pnpm smoke --keep`)
  const api = await AdminApi.owner()

  // Chưa cấu hình phí giao thì cửa hàng chưa nhận đơn. Tỉnh khác dùng mức mặc định cao hơn để thấy phí theo tỉnh.
  await api.send('PUT', '/api/admin/shipping-fees', {
    defaultFee: SHIPPING_FEE + 20_000,
    freeShippingThreshold: null,
    provinceFees: [{ provinceCode: PROVINCE_CODE, fee: SHIPPING_FEE }],
  })

  // Khách vãng lai phải đồng ý chính sách bảo mật đã xuất bản thì mới đặt được.
  const privacy =
    (await api.pages()).items.find((page) => page.slug === PRIVACY_POLICY_SLUG) ??
    (await api.createPage({
      slug: PRIVACY_POLICY_SLUG,
      kind: 'policy',
      title: 'Chính sách bảo mật',
      body: 'Dữ liệu dùng để giao hàng.',
    }))
  if (privacy.status !== 'published') await api.send('POST', `/api/admin/pages/${privacy.id}/publish`)

  const staff = (await api.staff()).items
  if (!staff.some((member) => member.email === WAREHOUSE.email)) {
    await api.send('POST', '/api/admin/staff', { ...WAREHOUSE, roles: ['warehouse'] })
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
