// Stack E2E là stack của `pnpm smoke --keep`: cổng, tài khoản owner và sản phẩm lấy từ seed trong scripts/smoke.ts.
import type {
  AdminOrder,
  ContentPageDetail,
  ContentPageList,
  StaffList,
  StockItem,
  StockMovementPage,
  StockPage,
} from '@ecommerce/shared'

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8081'

export const OWNER = { email: 'smoke@example.com', password: 'mat-khau-smoke-test' }
/** Nhân viên kho do global-setup tạo nếu chưa có. */
export const WAREHOUSE = { email: 'kho-e2e@example.com', password: 'mat-khau-kho-e2e-test', name: 'Kho E2E' }

/** Biến thể còn hàng của sản phẩm seed (smoke đặt tồn 3). */
export const PRODUCT_PATH = '/san-pham/air-max-90?sku=AM90-DEN-40'
export const SKU = 'AM90-DEN-40'
export const PRICE = 3_500_000
/** TP. Hồ Chí Minh; global-setup đặt phí giao riêng cho tỉnh này. */
export const PROVINCE_CODE = '79'
export const SHIPPING_FEE = 30_000

const OWNER_TOKEN_ENV = 'E2E_OWNER_ACCESS_TOKEN'

/** Gọi API quản trị bằng access token (client `mobile`, không cần cookie). */
export class AdminApi {
  private constructor(private readonly token: string) {}

  /**
   * Owner đăng nhập một lần ở global-setup, token (sống 15 phút) truyền cho các test qua biến môi trường:
   * đăng nhập bị giới hạn 10 lần mỗi email trong 15 phút, chạy lại vài lần là chạm.
   */
  static async owner() {
    const token = process.env[OWNER_TOKEN_ENV]
    if (token) return new AdminApi(token)
    const { accessToken } = await send<{ accessToken: string }>('POST', '/api/admin/auth/login', undefined, OWNER)
    process.env[OWNER_TOKEN_ENV] = accessToken
    return new AdminApi(accessToken)
  }

  get<T>(path: string) {
    return send<T>('GET', path, this.token)
  }

  send<T>(method: 'POST' | 'PUT', path: string, body?: unknown) {
    return send<T>(method, path, this.token, body)
  }

  async stockOf(sku: string): Promise<StockItem> {
    const page = await this.get<StockPage>(`/api/admin/stock?q=${encodeURIComponent(sku)}`)
    const item = page.items.find((i) => i.sku === sku)
    if (!item) throw new Error(`Không thấy tồn của ${sku}`)
    return item
  }

  movementsOf(variantId: string) {
    return this.get<StockMovementPage>(`/api/admin/stock/movements?variantId=${variantId}&pageSize=5`)
  }

  order(code: string) {
    return this.get<AdminOrder>(`/api/admin/orders/${code}`)
  }

  pages() {
    return this.get<ContentPageList>('/api/admin/pages')
  }

  createPage(body: { slug: string; kind: string; title: string; body: string }) {
    return this.send<ContentPageDetail>('POST', '/api/admin/pages', body)
  }

  staff() {
    return this.get<StaffList>('/api/admin/staff')
  }
}

async function send<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Client': 'mobile',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} ${path} trả ${res.status}: ${await res.text()}`)
  return (res.status === 204 ? undefined : await res.json()) as T
}
