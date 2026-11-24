// Full-stack smoke check: brings up docker compose in its own project, seeds data via the API, then reads the real HTML
// customers get. Catches what typecheck and API tests miss, e.g. a layout not rendering.
// Run: pnpm smoke            (removes the stack and volumes afterwards)
//      pnpm smoke --keep     (keeps the stack to browse at http://localhost:8081)
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PROJECT = 'ecommerce-smoke'
const HTTP_PORT = '8081'
const BASE = `http://localhost:${HTTP_PORT}`
const KEEP = process.argv.includes('--keep')
const OWNER = { email: 'smoke@example.com', password: 'mat-khau-smoke-test', name: 'Smoke' }

// Own ports so it runs beside the dev stack; the DB is in this project's own volume, so dev data is untouched.
const env = {
  ...process.env,
  HTTP_PORT,
  HTTPS_PORT: '8444',
  // Windows sometimes reserves a port range (Hyper-V) that may cover 55432: set SMOKE_POSTGRES_PORT to change it.
  POSTGRES_PORT: process.env.SMOKE_POSTGRES_PORT ?? '55432',
  JWT_SECRET: randomBytes(32).toString('base64url'),
  // Ignore the local .env: no SeaweedFS (it would fight the dev stack for port 9000), files kept in memory.
  COMPOSE_PROFILES: '',
  STORAGE_PROVIDER: 'memory',
  // Always the simulator, even if the local .env has VNPAY keys: smoke must never create orders at VNPAY.
  VNPAY_TMN_CODE: '',
  VNPAY_HASH_SECRET: '',
  PAYMENT_SIMULATOR: 'allow',
  // The chatbot uses the fake model even with keys in the local .env: smoke and E2E never call Groq or OpenRouter (ADR
  // 0017).
  GROQ_API_KEY: '',
  OPENROUTER_API_KEY: '',
  LLM_CHAIN: 'fake',
}

function compose(...args: string[]) {
  execFileSync('docker', ['compose', '-p', PROJECT, ...args], { env, stdio: 'inherit' })
}

async function waitFor(path: string, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(BASE + path).catch(() => null)
    if (res?.ok) return
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error(`${path} không lên sau ${timeoutMs / 1000}s`)
}

async function api(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Client': 'mobile',
      ...(init.token && { Authorization: `Bearer ${init.token}` }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} trả ${res.status}: ${await res.text()}`)
  return res.json() as Promise<Record<string, unknown>>
}

async function seed() {
  compose(
    'exec',
    '-T',
    '-e',
    `OWNER_EMAIL=${OWNER.email}`,
    '-e',
    `OWNER_PASSWORD=${OWNER.password}`,
    '-e',
    `OWNER_NAME=${OWNER.name}`,
    'api',
    'pnpm',
    'seed:owner',
  )
  const { accessToken } = await api('/api/admin/auth/login', { method: 'POST', body: OWNER })
  const token = String(accessToken)

  const published = await api('/api/admin/pages', {
    method: 'POST',
    token,
    body: { slug: 'chinh-sach-doi-tra', kind: 'policy', title: 'Chính sách đổi trả', body: 'Đổi trong **7 ngày**.' },
  })
  await api(`/api/admin/pages/${published.id}/publish`, { method: 'POST', token })
  await api('/api/admin/pages', {
    method: 'POST',
    token,
    body: { slug: 'trang-nhap', kind: 'about', title: 'Trang nháp', body: 'Chưa duyệt' },
  })
  await api('/api/admin/brands', {
    method: 'POST',
    token,
    body: { name: 'Seiko', slug: 'seiko', description: 'Đồng hồ Nhật' },
  })
  const hiddenBrand = await api('/api/admin/brands', {
    method: 'POST',
    token,
    body: { name: 'Hãng Ẩn', slug: 'hang-an' },
  })
  await api(`/api/admin/brands/${hiddenBrand.id}/hide`, { method: 'POST', token })
  const sneaker = await api('/api/admin/categories', {
    method: 'POST',
    token,
    body: { name: 'Sneaker', slug: 'sneaker', productType: 'footwear' },
  })
  const lowTop = await api('/api/admin/categories', {
    method: 'POST',
    token,
    body: { name: 'Sneaker cổ thấp', slug: 'sneaker-co-thap', productType: 'footwear', parentId: sneaker.id },
  })
  await seedPublishedProduct(token, String(lowTop.id), String(published.id))
  await api('/api/admin/legal-info', {
    method: 'PUT',
    token,
    body: {
      companyName: 'Công ty Smoke Test',
      businessRegistrationNumber: '0312345678',
      businessRegistrationIssuedBy: 'Sở Kế hoạch và Đầu tư',
      businessRegistrationIssuedOn: '2020-03-12',
      address: '12 Nguyễn Huệ',
      phone: '0281234567',
      email: 'lienhe@example.com',
      moitLogoUrl: 'https://example.com/bct.png',
      moitNoticeUrl: 'http://online.gov.vn/x',
    },
  })
}

/** A 1×1 PNG, enough for the API to build image widths. */
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** A published product in a subcategory, two variants, one image, with the returns policy. */
async function seedPublishedProduct(token: string, categoryId: string, policyPageId: string) {
  const brand = await api('/api/admin/brands', { method: 'POST', token, body: { name: 'Nike', slug: 'nike' } })
  const product = await api('/api/admin/products', {
    method: 'POST',
    token,
    body: {
      brandId: brand.id,
      categoryId,
      name: 'Air Max 90',
      slug: 'air-max-90',
      originStatement: 'Nhập khẩu chính ngạch từ Nike Mỹ.',
      attributes: { gioi_tinh: 'Nam', he_size: 'EU' },
    },
  })
  const base = `/api/admin/products/${product.id}`
  const black = await api(`${base}/variants`, {
    method: 'POST',
    token,
    body: { sku: 'AM90-DEN-40', attributes: { mau: 'Đen', size: '40' }, price: 3_500_000, compareAtPrice: 4_000_000 },
  })
  await api(`${base}/variants`, {
    method: 'POST',
    token,
    body: { sku: 'AM90-TRANG-41', attributes: { mau: 'Trắng', size: '41' }, price: 3_200_000 },
  })
  // Black in stock, White out of stock (M2): the product page shows both states.
  await api('/api/admin/stock/adjustments', {
    method: 'POST',
    token,
    body: { variantId: black.id, reason: 'stocktake', countedQuantity: 3, expectedOnHand: 0 },
  })
  const form = new FormData()
  form.append('file', new Blob([Buffer.from(PIXEL_PNG, 'base64')], { type: 'image/png' }), 'anh.png')
  const upload = await fetch(`${BASE}${base}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!upload.ok) throw new Error(`Tải ảnh trả ${upload.status}: ${await upload.text()}`)
  await api(`${base}/policies`, { method: 'PUT', token, body: { pageIds: [policyPageId] } })

  // A warranty commitment based on a document (ticket 13), shown apart from the origin statement.
  const pdf = new FormData()
  pdf.append('file', new Blob([Buffer.from('%PDF-1.7\n%%EOF\n')], { type: 'application/pdf' }), 'hoa-don.pdf')
  const document = await fetch(`${BASE}${base}/documents`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: pdf,
  })
  if (!document.ok) throw new Error(`Tải chứng từ trả ${document.status}: ${await document.text()}`)
  const { id: documentId } = (await document.json()) as { id: string }
  const types = (await api('/api/admin/commitment-types', { token })).items as { id: string; name: string }[]
  const warranty = types.find((type) => type.name === 'Bảo hành chính hãng')!
  await api(`${base}/commitments`, {
    method: 'POST',
    token,
    body: { typeId: warranty.id, statement: 'Bảo hành chính hãng Nike 12 tháng', documentIds: [documentId] },
  })
  await api(`${base}/status`, { method: 'PUT', token, body: { status: 'published' } })
}

type Check = {
  path: string
  status: number
  contains: string[]
  excludes?: string[]
  /** The response header must contain this text (lowercase header name). */
  headers?: Record<string, string>
}

// Unbacked origin claims are a legal risk (ADR 0005). Product pages are exempt since evidenced commitments there may
// use these words.
const UNFOUNDED_CLAIMS = ['chính hãng', 'đại lý ủy quyền', 'phân phối độc quyền', 'trực tiếp nhập khẩu']
const mayClaim = (path: string) => path.startsWith('/san-pham/')

const canonical = (path: string) => `<link rel="canonical" href="${BASE}${path}">`
const NOINDEX = '<meta name="robots" content="noindex, follow">'

// HTML customers get from SSR. Admin is an SPA, so only its shell can be checked; content needs a browser.
const CHECKS: Check[] = [
  {
    path: '/',
    status: 200,
    contains: [
      '<footer',
      'Công ty Smoke Test',
      'alt="Đã thông báo Bộ Công Thương"',
      '<summary>Danh mục</summary>',
      'href="/tai-khoan"',
      // The cart icon; the item count exists only after mount, so server HTML lacks it.
      'href="/gio-hang"',
      'Giày dép',
      'href="/danh-muc/sneaker-co-thap"',
      'role="search"',
      // The Nam / Nữ menu is the search page filtered by gender (ADR 0004).
      'href="/tim-kiem?attr.gioi_tinh=Nam"',
    ],
  },
  // Search without diacritics, by SKU, gender filter (Nam includes Unisex; the smoke product is Nam), facets by type.
  {
    path: '/tim-kiem?q=air+max',
    status: 200,
    // Search results are not indexed (duplicate content).
    contains: ['>Kết quả cho “air max”</h1>', 'href="/san-pham/air-max-90"', '1 sản phẩm', '<footer', NOINDEX],
  },
  { path: '/tim-kiem?q=am90-trang', status: 200, contains: ['href="/san-pham/air-max-90"'] },
  {
    path: '/tim-kiem?attr.gioi_tinh=Nam',
    status: 200,
    contains: ['>Sản phẩm Nam</h1>', 'href="/san-pham/air-max-90"', 'Bộ lọc (1)', 'name="attr.gioi_tinh"'],
  },
  { path: '/tim-kiem?attr.gioi_tinh=N%E1%BB%AF', status: 200, contains: ['Không tìm thấy sản phẩm phù hợp'] },
  {
    path: '/danh-muc/sneaker?attr.size=41&sort=price_asc',
    status: 200,
    // Filtered URLs: noindex, canonical to the base category page.
    contains: [
      'href="/san-pham/air-max-90"',
      'name="attr.size"',
      'name="attr.mau"',
      'name="minPrice"',
      NOINDEX,
      canonical('/danh-muc/sneaker'),
    ],
  },
  {
    path: '/danh-muc/sneaker',
    status: 200,
    // Products in subcategories also show in the parent; the "từ" price is the lowest.
    contains: [
      '<h1>Sneaker</h1>',
      'href="/danh-muc/sneaker-co-thap"',
      'href="/san-pham/air-max-90"',
      'từ 3.200.000 ₫',
      canonical('/danh-muc/sneaker'),
      '<meta property="og:title" content="Sneaker">',
    ],
    excludes: ['noindex'],
    headers: { 'cache-control': 's-maxage=60' },
  },
  {
    path: '/san-pham/air-max-90',
    status: 200,
    contains: [
      '>Air Max 90</h1>',
      '>AM90-DEN-40<',
      'Giá hãng',
      'href="/san-pham/air-max-90?sku=AM90-TRANG-41"',
      'Nhập khẩu chính ngạch từ Nike Mỹ.',
      'href="/trang/chinh-sach-doi-tra"',
      'Cam kết có chứng từ',
      'Bảo hành chính hãng Nike 12 tháng',
      '<footer',
      canonical('/san-pham/air-max-90'),
      '<meta property="og:title" content="Air Max 90">',
      `<meta property="og:url" content="${BASE}/san-pham/air-max-90">`,
      '<meta property="og:image" content="',
      '<meta name="description" content="Air Max 90 của Nike, giá từ 3.200.000 ₫.">',
      // The selected variant (Black) is in stock; the White option shows "Hết hàng".
      'data-testid="availability"',
      'Còn hàng',
      'Hết hàng',
      'data-testid="add-to-cart"',
      'Thêm vào giỏ',
      // Structured data: VND price range of the two variants on sale, in stock since Black is, brand, image.
      '<script type="application/ld+json">',
      '"@type":"Product"',
      '"brand":{"@type":"Brand","name":"Nike"}',
      '"@type":"AggregateOffer","lowPrice":3200000,"highPrice":3500000,"offerCount":2,"priceCurrency":"VND","availability":"https://schema.org/InStock"',
      '"image":["',
    ],
    excludes: ['noindex'],
    headers: { 'cache-control': 's-maxage=60' },
  },
  // Variant pages share the product page's canonical.
  {
    path: '/san-pham/air-max-90?sku=AM90-TRANG-41',
    status: 200,
    contains: ['>AM90-TRANG-41<', '3.200.000 ₫', canonical('/san-pham/air-max-90'), 'Hết hàng'],
  },
  { path: '/san-pham/khong-co', status: 404, contains: ['Không tìm thấy sản phẩm'] },
  {
    path: '/thuong-hieu/nike',
    status: 200,
    contains: [
      '>Nike</h1>',
      'href="/san-pham/air-max-90"',
      canonical('/thuong-hieu/nike'),
      '<meta property="og:title"',
    ],
  },
  { path: '/danh-muc/khong-co', status: 404, contains: ['Không tìm thấy danh mục'] },
  { path: '/thuong-hieu', status: 200, contains: ['href="/thuong-hieu/seiko"'] },
  { path: '/thuong-hieu/seiko', status: 200, contains: ['>Seiko</h1>', 'Đồng hồ Nhật', 'Chưa có sản phẩm'] },
  { path: '/thuong-hieu/hang-an', status: 404, contains: ['Không tìm thấy thương hiệu'] },
  {
    path: '/trang/chinh-sach-doi-tra',
    status: 200,
    contains: [
      '<h1>Chính sách đổi trả</h1>',
      '<strong>7 ngày</strong>',
      '<footer',
      canonical('/trang/chinh-sach-doi-tra'),
      '<meta name="description" content="Đổi trong 7 ngày.">',
    ],
  },
  { path: '/trang/trang-nhap', status: 404, contains: ['Không tìm thấy trang', '<footer'] },
  {
    path: '/dang-ky',
    status: 200,
    contains: [
      '<h1>Đăng ký tài khoản</h1>',
      'name="acceptPrivacyPolicy"',
      'href="/trang/chinh-sach-bao-mat"',
      '<footer',
    ],
  },
  {
    path: '/dang-nhap',
    status: 200,
    contains: ['<h1>Đăng nhập</h1>', 'autocomplete="current-password"', 'href="/quen-mat-khau"'],
  },
  { path: '/quen-mat-khau', status: 200, contains: ['<h1>Quên mật khẩu</h1>', 'name="email"'] },
  // The token is only used when the form is submitted, so opening the link with any token still shows the form.
  {
    path: '/dat-lai-mat-khau?token=bat-ky',
    status: 200,
    contains: ['<h1>Đặt lại mật khẩu</h1>', 'autocomplete="new-password"'],
  },
  // The customer session exists only in the browser, so server HTML is just the page frame.
  { path: '/tai-khoan', status: 200, contains: ['<h1>Tài khoản</h1>', 'Đang tải'] },
  { path: '/tai-khoan/don-hang/100000', status: 200, contains: ['Đơn hàng #100000', 'Đang tải', NOINDEX] },
  // The cart is in browser localStorage, so server HTML is just the page frame.
  { path: '/gio-hang', status: 200, contains: ['<h1>Giỏ hàng</h1>', 'Đang tải', NOINDEX] },
  // Checkout and token orders are personal data: server HTML is just the page frame.
  { path: '/dat-mua', status: 200, contains: ['<h1>Đặt mua</h1>', 'Đang tải', NOINDEX] },
  // Pre-orders skip the cart (ADR 0012); shipping info is personal data, so only the frame.
  {
    path: '/dat-truoc/00000000-0000-4000-8000-000000000000',
    status: 200,
    contains: ['<h1>Đặt trước</h1>', 'Đang tải', NOINDEX],
  },
  { path: '/don-hang/100000?token=sai', status: 200, contains: ['Đơn hàng #100000', 'Đang tải', NOINDEX] },
  // The page the gateway returns customers to: no token in the URL, it is in the browser's sessionStorage.
  { path: '/don-hang/100000?ket-qua=1', status: 200, contains: ['Đơn hàng #100000', 'Đang tải', NOINDEX] },
  // The smoke stack has no VNPAY keys, so it uses the simulator.
  {
    path: '/thanh-toan-gia-lap?orderCode=100000&amount=2030000',
    status: 200,
    contains: [
      '<h1>Cổng thanh toán giả lập</h1>',
      '#100000',
      'Giả lập đã thanh toán',
      'Giả lập hết hạn',
      'Số tiền chuyển',
      NOINDEX,
    ],
  },
  { path: '/xac-minh-email?token=sai', status: 200, contains: ['Link xác minh không hợp lệ hoặc đã hết hạn'] },
  {
    path: '/admin/login',
    status: 200,
    contains: ['<div id="__nuxt">'],
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' },
  },
  // The sitemap holds only published, visible content; absolute URLs per SITE_URL.
  {
    path: '/sitemap.xml',
    status: 200,
    contains: [
      `<loc>${BASE}/san-pham/air-max-90</loc>`,
      `<loc>${BASE}/danh-muc/sneaker</loc>`,
      `<loc>${BASE}/danh-muc/sneaker-co-thap</loc>`,
      `<loc>${BASE}/thuong-hieu/seiko</loc>`,
      `<loc>${BASE}/trang/chinh-sach-doi-tra</loc>`,
    ],
    excludes: ['trang-nhap', 'hang-an'],
    headers: { 'content-type': 'application/xml' },
  },
  {
    path: '/robots.txt',
    status: 200,
    contains: ['Disallow: /admin', 'Disallow: /api', `Sitemap: ${BASE}/sitemap.xml`],
  },
]

async function runChecks(): Promise<number> {
  let failures = 0
  for (const check of CHECKS) {
    // Send Accept like browsers do; without it Nuxt returns a JSON error page.
    const res = await fetch(BASE + check.path, { headers: { Accept: 'text/html' } })
    const html = await res.text()
    const problems = [
      ...(res.status === check.status ? [] : [`status ${res.status}, cần ${check.status}`]),
      ...check.contains.filter((text) => !html.includes(text)).map((text) => `thiếu ${text}`),
      ...(check.excludes ?? []).filter((text) => html.includes(text)).map((text) => `không được có ${text}`),
      ...(mayClaim(check.path) ? [] : UNFOUNDED_CLAIMS)
        .filter((claim) => html.toLowerCase().includes(claim))
        .map((claim) => `lời khẳng định không có căn cứ: ${claim}`),
      ...Object.entries(check.headers ?? {})
        .filter(([name, text]) => !res.headers.get(name)?.includes(text))
        .map(([name, text]) => `header ${name} là ${res.headers.get(name)}, cần chứa ${text}`),
    ]
    failures += problems.length ? 1 : 0
    console.log(problems.length ? `✗ ${check.path}: ${problems.join('; ')}` : `✓ ${check.path}`)
  }
  return failures
}

try {
  execFileSync('docker', ['info'], { stdio: 'ignore' })
} catch {
  console.error('Docker chưa chạy; mở Docker Desktop rồi chạy lại.')
  process.exit(1)
}

function teardown() {
  if (KEEP) return console.log(`Stack vẫn chạy tại ${BASE}. Xóa bằng: docker compose -p ${PROJECT} down -v`)
  // Cleanup errors are only reported, so they never hide the earlier step's original error.
  try {
    compose('down', '-v')
  } catch {
    console.error(`Không xóa được stack; xóa tay bằng: docker compose -p ${PROJECT} down -v`)
  }
}

try {
  compose('up', '--build', '-d')
  await waitFor('/healthz')
  await waitFor('/')
  await seed()
  const failures = await runChecks()
  console.log(failures ? `Smoke check: ${failures} trang lỗi` : 'Smoke check: đạt')
  process.exitCode = failures ? 1 : 0
} finally {
  teardown()
}
