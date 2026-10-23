// Smoke check toàn stack: dựng docker compose ở một project riêng, seed dữ liệu qua API rồi đọc HTML thật mà khách nhận.
// Bắt những lỗi typecheck và test API không thấy, ví dụ layout không được render.
// Chạy: pnpm smoke            (xong thì xóa stack và volume)
//       pnpm smoke --keep     (giữ stack để mở trình duyệt xem, tại http://localhost:8081)
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const PROJECT = 'ecommerce-smoke'
const HTTP_PORT = '8081'
const BASE = `http://localhost:${HTTP_PORT}`
const KEEP = process.argv.includes('--keep')
const OWNER = { email: 'smoke@example.com', password: 'mat-khau-smoke-test', name: 'Smoke' }

// Cổng riêng để chạy được cạnh stack dev; DB nằm trong volume riêng của project này nên không đụng dữ liệu dev.
const env = {
  ...process.env,
  HTTP_PORT,
  HTTPS_PORT: '8444',
  POSTGRES_PORT: '55432',
  JWT_SECRET: randomBytes(32).toString('base64url'),
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
  await api('/api/admin/categories', {
    method: 'POST',
    token,
    body: { name: 'Sneaker cổ thấp', slug: 'sneaker-co-thap', productType: 'footwear', parentId: sneaker.id },
  })
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

type Check = { path: string; status: number; contains: string[] }

// HTML khách nhận khi render SSR. Trang quản trị là SPA nên chỉ kiểm được shell, nội dung cần trình duyệt.
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
      'Giày dép',
      'href="/danh-muc/sneaker-co-thap"',
    ],
  },
  {
    path: '/danh-muc/sneaker',
    status: 200,
    contains: ['<h1>Sneaker</h1>', 'href="/danh-muc/sneaker-co-thap"', 'Chưa có sản phẩm', '<footer'],
  },
  { path: '/danh-muc/khong-co', status: 404, contains: ['Không tìm thấy danh mục'] },
  { path: '/thuong-hieu', status: 200, contains: ['href="/thuong-hieu/seiko"'] },
  { path: '/thuong-hieu/seiko', status: 200, contains: ['<h1>Seiko</h1>', 'Đồng hồ Nhật', 'Chưa có sản phẩm'] },
  { path: '/thuong-hieu/hang-an', status: 404, contains: ['Không tìm thấy thương hiệu'] },
  {
    path: '/trang/chinh-sach-doi-tra',
    status: 200,
    contains: ['<h1>Chính sách đổi trả</h1>', '<strong>7 ngày</strong>', '<footer'],
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
  { path: '/dang-nhap', status: 200, contains: ['<h1>Đăng nhập</h1>', 'autocomplete="current-password"'] },
  // Phiên khách chỉ có ở trình duyệt, nên HTML từ server chỉ có khung trang.
  { path: '/tai-khoan', status: 200, contains: ['<h1>Tài khoản</h1>', 'Đang tải'] },
  { path: '/xac-minh-email?token=sai', status: 200, contains: ['Link xác minh không hợp lệ hoặc đã hết hạn'] },
  { path: '/admin/login', status: 200, contains: ['<div id="__nuxt">'] },
]

async function runChecks(): Promise<number> {
  let failures = 0
  for (const check of CHECKS) {
    // Gửi Accept như trình duyệt; không có thì Nuxt trả trang lỗi dạng JSON.
    const res = await fetch(BASE + check.path, { headers: { Accept: 'text/html' } })
    const html = await res.text()
    const problems = [
      ...(res.status === check.status ? [] : [`status ${res.status}, cần ${check.status}`]),
      ...check.contains.filter((text) => !html.includes(text)).map((text) => `thiếu ${text}`),
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
  // Dọn dẹp lỗi thì chỉ báo, để không che lỗi gốc của bước trước.
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
