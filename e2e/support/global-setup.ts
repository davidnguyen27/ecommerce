// Adds data the smoke seed lacks but the purchase flow needs. Safe to rerun on the same stack: existing steps are
// skipped.
import { PREORDER_POLICY_SLUG, PRIVACY_POLICY_SLUG } from '@ecommerce/shared'
import { resetRateLimits } from './rate-limit.ts'
import { ACCOUNTANT, AdminApi, BASE_URL, PROVINCE_CODE, SALES, SHIPPING_FEE, SKU, WAREHOUSE } from './stack.ts'

export default async function globalSetup() {
  const health = await fetch(`${BASE_URL}/healthz`).catch(() => null)
  if (!health?.ok) throw new Error(`Không thấy stack ở ${BASE_URL}; dựng bằng: pnpm smoke --keep`)
  // Reruns on the same stack do not hit the previous run's checkout limit.
  resetRateLimits()
  const api = await AdminApi.owner()

  // Without shipping config the shop takes no orders. Other provinces use a higher default to show per-province fees.
  await api.send('PUT', '/api/admin/shipping-fees', {
    defaultFee: SHIPPING_FEE + 20_000,
    freeShippingThreshold: null,
    provinceFees: [{ provinceCode: PROVINCE_CODE, fee: SHIPPING_FEE }],
  })

  // Guests can only order once a privacy policy is published; pre-orders also need a published pre-order policy.
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

  // One unit sold per run; with less than one sellable (after many reruns), stocktake it back up.
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
