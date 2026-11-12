// Dữ liệu mẫu để xem website ở local: chính sách, thông tin pháp lý, đủ năm nhóm hàng, sản phẩm đã xuất bản kèm ảnh.
// Đi qua API thật như nhân viên nhập liệu. Ảnh là ảnh minh họa tự sinh, không phải ảnh của hãng.
// Cần stack local đang chạy với S3 (COMPOSE_PROFILES=local, xem .env.example), DB chưa có dữ liệu demo.
// Chạy: node scripts/demo-seed.ts
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { PRIVACY_POLICY_SLUG } from '../shared/src/content.ts'

const BASE = `http://localhost:${process.env.HTTP_PORT ?? '80'}`
const OWNER = { email: 'chu-shop@example.com', password: 'mat-khau-demo-local', name: 'Chủ shop' }

// sharp là dependency của api, không có ở gốc repo.
const sharp = createRequire(new URL('../api/package.json', import.meta.url))('sharp') as typeof import('sharp')

type Json = Record<string, unknown>

async function api(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<Json> {
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
  return res.status === 204 ? {} : ((await res.json()) as Json)
}

async function upload(path: string, token: string, method: string, file: Blob, name: string): Promise<Json> {
  const form = new FormData()
  form.append('file', file, name)
  const res = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${token}` }, body: form })
  if (!res.ok) throw new Error(`${method} ${path} trả ${res.status}: ${await res.text()}`)
  return (await res.json()) as Json
}

const escapeXml = (text: string) => text.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`)

/** Ảnh minh họa 4:5 nền màu, ghi tên hãng và tên sản phẩm. */
async function placeholderImage(brand: string, title: string, color: string): Promise<Blob> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0.9"/>
    </linearGradient></defs>
    <rect width="1200" height="1500" fill="#f4f1ec"/><rect width="1200" height="1500" fill="url(#g)"/>
    <circle cx="600" cy="640" r="330" fill="#ffffff" fill-opacity="0.35"/>
    <text x="600" y="600" font-family="Georgia, serif" font-size="92" text-anchor="middle" fill="#1b1b1f">${escapeXml(brand.toUpperCase())}</text>
    <text x="600" y="720" font-family="Arial, sans-serif" font-size="${Math.min(58, Math.floor(1900 / title.length))}" text-anchor="middle" fill="#1b1b1f">${escapeXml(title)}</text>
    <text x="600" y="1400" font-family="Arial, sans-serif" font-size="34" text-anchor="middle" fill="#1b1b1f" fill-opacity="0.6">ANH MINH HOA - DEMO</text>
  </svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return new Blob([new Uint8Array(png)], { type: 'image/png' })
}

async function logoImage(brand: string): Promise<Blob> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">
    <rect width="600" height="600" fill="#1b1b1f"/>
    <text x="300" y="330" font-family="Georgia, serif" font-size="${brand.length > 8 ? 64 : 84}" text-anchor="middle" fill="#ffffff">${escapeXml(brand.toUpperCase())}</text>
  </svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return new Blob([new Uint8Array(png)], { type: 'image/png' })
}

type ProductType = 'footwear' | 'apparel' | 'watch' | 'bag' | 'fragrance'

type Variant = { sku: string; attributes: Json; price: number; compareAtPrice?: number }

type DemoProduct = {
  brand: string
  category: string
  name: string
  slug: string
  modelCode: string
  description: string
  usageCare: string
  attributes: Json
  variants: Variant[]
  /** Mỗi ảnh một màu; ảnh có `color` thì gắn vào các biến thể cùng màu. */
  images: { color?: string; tint: string }[]
  groundShippingOnly?: boolean
  /** Có chứng từ nhập khẩu và cam kết bảo hành chính hãng. */
  warranty?: string
}

const BRANDS = [
  { name: 'Nike', slug: 'nike', description: 'Thương hiệu thể thao của Mỹ.' },
  { name: 'Adidas', slug: 'adidas', description: 'Thương hiệu thể thao của Đức.' },
  { name: 'Ralph Lauren', slug: 'ralph-lauren', description: 'Thời trang Mỹ phong cách cổ điển.' },
  { name: 'The North Face', slug: 'the-north-face', description: 'Trang phục và đồ dã ngoại.' },
  { name: 'Seiko', slug: 'seiko', description: 'Đồng hồ Nhật Bản từ 1881.' },
  { name: 'Casio', slug: 'casio', description: 'Đồng hồ điện tử bền bỉ của Nhật.' },
  { name: 'Coach', slug: 'coach', description: 'Đồ da New York từ 1941.' },
  { name: 'Michael Kors', slug: 'michael-kors', description: 'Túi xách và phụ kiện Mỹ.' },
  { name: 'Dior', slug: 'dior', description: 'Nhà mốt và nước hoa Pháp.' },
  { name: 'Chanel', slug: 'chanel', description: 'Nhà mốt và nước hoa Pháp.' },
]

/** Danh mục: cha theo nhóm hàng, rồi danh mục con. */
const CATEGORIES: {
  name: string
  slug: string
  productType: ProductType
  children: { name: string; slug: string }[]
}[] = [
  {
    name: 'Sneaker',
    slug: 'sneaker',
    productType: 'footwear',
    children: [
      { name: 'Sneaker cổ thấp', slug: 'sneaker-co-thap' },
      { name: 'Giày chạy bộ', slug: 'giay-chay-bo' },
    ],
  },
  {
    name: 'Áo',
    slug: 'ao',
    productType: 'apparel',
    children: [
      { name: 'Áo polo', slug: 'ao-polo' },
      { name: 'Áo khoác', slug: 'ao-khoac' },
    ],
  },
  {
    name: 'Đồng hồ nam',
    slug: 'dong-ho-nam',
    productType: 'watch',
    children: [
      { name: 'Đồng hồ cơ', slug: 'dong-ho-co' },
      { name: 'Đồng hồ thể thao', slug: 'dong-ho-the-thao' },
    ],
  },
  {
    name: 'Túi nữ',
    slug: 'tui-nu',
    productType: 'bag',
    children: [
      { name: 'Túi đeo vai', slug: 'tui-deo-vai' },
      { name: 'Túi tote', slug: 'tui-tote' },
    ],
  },
  {
    name: 'Nước hoa',
    slug: 'nuoc-hoa',
    productType: 'fragrance',
    children: [
      { name: 'Nước hoa nam', slug: 'nuoc-hoa-nam' },
      { name: 'Nước hoa nữ', slug: 'nuoc-hoa-nu' },
    ],
  },
]

const sizes = (prefix: string, color: string, list: string[], price: number, compareAtPrice?: number): Variant[] =>
  list.map((size) => ({
    sku: `${prefix}-${size}`,
    attributes: { mau: color, size },
    price,
    ...(compareAtPrice && { compareAtPrice }),
  }))

const PRODUCTS: DemoProduct[] = [
  {
    brand: 'nike',
    category: 'sneaker-co-thap',
    name: 'Nike Air Max 90',
    slug: 'nike-air-max-90',
    modelCode: 'CN8490',
    description:
      'Thiết kế kinh điển từ năm 1990 với bộ đệm Air nhìn thấy được ở gót. Thân giày da và lưới thoáng khí, đế cao su waffle bám tốt.',
    usageCare: 'Lau bằng khăn ẩm, tránh giặt máy. Phơi nơi thoáng mát, không phơi nắng gắt.',
    attributes: { gioi_tinh: 'Nam', he_size: 'EU', chat_lieu: 'Da, lưới' },
    variants: [
      ...sizes('AM90-DEN', 'Đen', ['40', '41', '42'], 3_490_000, 3_990_000),
      ...sizes('AM90-TRANG', 'Trắng', ['40', '41', '42', '43'], 3_490_000, 3_990_000),
    ],
    images: [
      { color: 'Đen', tint: '#2b2d33' },
      { color: 'Trắng', tint: '#c9c4ba' },
    ],
    warranty: 'Bảo hành keo đế 6 tháng theo chính sách của nhà phân phối Nike.',
  },
  {
    brand: 'adidas',
    category: 'giay-chay-bo',
    name: 'Adidas Ultraboost Light',
    slug: 'adidas-ultraboost-light',
    modelCode: 'HQ6351',
    description:
      'Đệm Light BOOST nhẹ hơn 30% so với thế hệ trước, thân Primeknit ôm chân, đế Continental bám đường ướt.',
    usageCare: 'Tháo lót trước khi vệ sinh. Không sấy nóng.',
    attributes: { gioi_tinh: 'Unisex', he_size: 'EU', chat_lieu: 'Primeknit' },
    variants: [...sizes('UBL-XAM', 'Xám', ['40', '41', '42', '43'], 4_290_000)],
    images: [{ color: 'Xám', tint: '#8d9199' }],
  },
  {
    brand: 'ralph-lauren',
    category: 'ao-polo',
    name: 'Ralph Lauren Custom Slim Fit Polo',
    slug: 'ralph-lauren-custom-slim-fit-polo',
    modelCode: '710536856',
    description: 'Áo polo vải cotton mesh, logo Pony thêu trên ngực. Phom Custom Slim gọn gàng.',
    usageCare: 'Giặt máy nước lạnh, lộn trái khi giặt. Không tẩy.',
    attributes: { gioi_tinh: 'Nam', chat_lieu: '100% cotton', phom_dang: 'Slim fit' },
    variants: [
      ...sizes('RLPOLO-NAVY', 'Xanh navy', ['S', 'M', 'L', 'XL'], 2_690_000, 2_990_000),
      ...sizes('RLPOLO-TRANG', 'Trắng', ['S', 'M', 'L'], 2_690_000, 2_990_000),
    ],
    images: [
      { color: 'Xanh navy', tint: '#1f2a4a' },
      { color: 'Trắng', tint: '#d8d4cc' },
    ],
  },
  {
    brand: 'the-north-face',
    category: 'ao-khoac',
    name: 'The North Face 1996 Retro Nuptse',
    slug: 'the-north-face-1996-retro-nuptse',
    modelCode: 'NF0A3C8D',
    description: 'Áo phao lông vũ 700-fill, mũ gấp gọn trong cổ áo. Lớp ngoài nylon ripstop chống nước nhẹ.',
    usageCare: 'Giặt máy chế độ nhẹ với nước giặt đồ lông vũ, sấy nhiệt thấp kèm bóng sấy.',
    attributes: { gioi_tinh: 'Unisex', chat_lieu: 'Nylon ripstop, lông vũ', phom_dang: 'Relaxed fit' },
    variants: [...sizes('NUPTSE-DEN', 'Đen', ['S', 'M', 'L'], 8_990_000)],
    images: [{ color: 'Đen', tint: '#1d1e22' }],
  },
  {
    brand: 'seiko',
    category: 'dong-ho-co',
    name: 'Seiko Presage Cocktail Time SRPB43',
    slug: 'seiko-presage-cocktail-time-srpb43',
    modelCode: 'SRPB43J1',
    description:
      'Mặt số xanh lam vân tia lấy cảm hứng từ ly cocktail, máy cơ tự động 4R35 trữ cót 41 giờ, kính cứng Hardlex cong.',
    usageCare: 'Chống nước 5 bar: đi mưa, rửa tay được, không bơi. Bảo dưỡng máy 3 đến 5 năm một lần.',
    attributes: { gioi_tinh: 'Nam', kich_thuoc_mat: 40.5, chat_lieu: 'Thép không gỉ', loai_bo_may: 'Automatic' },
    variants: [{ sku: 'SRPB43J1', attributes: {}, price: 11_500_000, compareAtPrice: 12_900_000 }],
    images: [{ tint: '#3b6fb6' }],
    warranty: 'Bảo hành chính hãng Seiko 12 tháng cho bộ máy.',
  },
  {
    brand: 'casio',
    category: 'dong-ho-the-thao',
    name: 'Casio G-Shock GA-2100-1A1',
    slug: 'casio-g-shock-ga-2100-1a1',
    modelCode: 'GA-2100-1A1',
    description: 'Vỏ Carbon Core Guard mỏng nhẹ, mặt bát giác, chống va đập, chống nước 20 bar.',
    usageCare: 'Thay pin tại trung tâm bảo hành để giữ khả năng chống nước.',
    attributes: { gioi_tinh: 'Unisex', kich_thuoc_mat: 45.4, chat_lieu: 'Nhựa carbon', loai_bo_may: 'Quartz' },
    variants: [{ sku: 'GA-2100-1A1', attributes: {}, price: 3_290_000 }],
    images: [{ tint: '#2a2a2a' }],
  },
  {
    brand: 'coach',
    category: 'tui-deo-vai',
    name: 'Coach Tabby Shoulder Bag 26',
    slug: 'coach-tabby-shoulder-bag-26',
    modelCode: '73995',
    description: 'Túi đeo vai da bò mềm với khóa chữ C đặc trưng, hai dây đeo thay đổi được.',
    usageCare: 'Tránh nước và dầu. Nhét giấy giữ form khi cất, để trong túi vải đi kèm.',
    attributes: {
      gioi_tinh: 'Nữ',
      kich_thuoc: '26 x 15 x 8 cm',
      chat_lieu: 'Da bò',
      kieu_dang: 'Túi đeo vai',
      phu_kien_di_kem: 'Túi vải, dây đeo dài',
    },
    variants: [
      { sku: 'TABBY26-DEN', attributes: { mau: 'Đen' }, price: 12_900_000, compareAtPrice: 14_500_000 },
      { sku: 'TABBY26-BE', attributes: { mau: 'Be' }, price: 12_900_000, compareAtPrice: 14_500_000 },
    ],
    images: [
      { color: 'Đen', tint: '#22201e' },
      { color: 'Be', tint: '#c8a882' },
    ],
    warranty: 'Bảo hành khóa và đường may 12 tháng theo chính sách của Coach.',
  },
  {
    brand: 'michael-kors',
    category: 'tui-tote',
    name: 'Michael Kors Jet Set Travel Tote',
    slug: 'michael-kors-jet-set-travel-tote',
    modelCode: '35T0GTVT3B',
    description: 'Túi tote khổ lớn vải canvas in logo, quai da, ngăn trong vừa laptop 13 inch.',
    usageCare: 'Lau vết bẩn bằng khăn ẩm và xà phòng nhẹ.',
    attributes: { gioi_tinh: 'Nữ', kich_thuoc: '38 x 28 x 15 cm', chat_lieu: 'Canvas, da', kieu_dang: 'Túi tote' },
    variants: [{ sku: 'JETSET-NAU', attributes: { mau: 'Nâu' }, price: 6_490_000 }],
    images: [{ color: 'Nâu', tint: '#7a5638' }],
  },
  {
    brand: 'dior',
    category: 'nuoc-hoa-nam',
    name: 'Dior Sauvage Eau de Toilette',
    slug: 'dior-sauvage-eau-de-toilette',
    modelCode: 'F066024009',
    description: 'Hương cam bergamot Calabria tươi mát mở đầu, lớp nền Ambroxan ấm và gỗ.',
    usageCare: 'Bảo quản nơi khô mát, tránh ánh nắng trực tiếp.',
    attributes: { gioi_tinh: 'Nam', nong_do: 'Eau de Toilette', nhom_huong: ['Hương cam chanh', 'Hương gỗ'] },
    variants: [
      { sku: 'SAUVAGE-EDT-60', attributes: { dung_tich: 60, dang_dong_goi: 'Fullbox' }, price: 2_750_000 },
      {
        sku: 'SAUVAGE-EDT-100',
        attributes: { dung_tich: 100, dang_dong_goi: 'Fullbox' },
        price: 3_650_000,
        compareAtPrice: 3_950_000,
      },
      { sku: 'SAUVAGE-EDT-100-TESTER', attributes: { dung_tich: 100, dang_dong_goi: 'Tester' }, price: 2_950_000 },
    ],
    images: [{ tint: '#3a5a7a' }],
    groundShippingOnly: true,
  },
  {
    brand: 'chanel',
    category: 'nuoc-hoa-nu',
    name: 'Chanel Coco Mademoiselle Eau de Parfum',
    slug: 'chanel-coco-mademoiselle-eau-de-parfum',
    modelCode: '116520',
    description: 'Hương hoa hồng và hoắc hương trên nền cam chanh, nữ tính và hiện đại.',
    usageCare: 'Xịt lên cổ tay, sau tai; không chà xát sau khi xịt.',
    attributes: { gioi_tinh: 'Nữ', nong_do: 'Eau de Parfum', nhom_huong: ['Hương hoa', 'Hương phương Đông'] },
    variants: [
      { sku: 'COCOMADEMOISELLE-50', attributes: { dung_tich: 50, dang_dong_goi: 'Fullbox' }, price: 3_950_000 },
      { sku: 'COCOMADEMOISELLE-100', attributes: { dung_tich: 100, dang_dong_goi: 'Fullbox' }, price: 5_450_000 },
    ],
    images: [{ tint: '#c79aa3' }],
    groundShippingOnly: true,
    warranty: 'Cam kết chính hãng, có hóa đơn nhập khẩu từ nhà phân phối Chanel.',
  },
]

const PAGES = [
  {
    slug: PRIVACY_POLICY_SLUG,
    kind: 'policy',
    title: 'Chính sách bảo mật',
    body: 'Chúng tôi chỉ dùng email và số điện thoại của bạn để xử lý đơn hàng và chăm sóc khách hàng.\n\n- Không bán hay chia sẻ dữ liệu cho bên thứ ba.\n- Bạn có thể yêu cầu xóa tài khoản bất cứ lúc nào.',
  },
  {
    slug: 'chinh-sach-doi-tra',
    kind: 'policy',
    title: 'Chính sách đổi trả',
    body: 'Đổi size hoặc màu trong **7 ngày** kể từ khi nhận hàng, sản phẩm còn nguyên tem, mác và hộp.\n\nNước hoa đã mở seal không áp dụng đổi trả.',
  },
  {
    slug: 'chinh-sach-bao-hanh',
    kind: 'policy',
    title: 'Chính sách bảo hành',
    body: 'Mỗi sản phẩm ghi rõ cam kết bảo hành riêng, kèm chứng từ của nhà phân phối. Sản phẩm không ghi cam kết thì không có bảo hành.',
  },
  {
    slug: 'gioi-thieu',
    kind: 'about',
    title: 'Về chúng tôi',
    body: 'Cửa hàng hàng hiệu nhập khẩu chính ngạch. Mỗi sản phẩm công bố nguồn gốc, giá và chính sách trước khi bạn quyết định.',
  },
]

/** Phí giao mặc định của demo: chưa có thì khách không đặt mua được ("Cửa hàng chưa sẵn sàng nhận đơn"). */
async function ensureShippingFee(token: string) {
  const current = await api('/api/admin/shipping-fees', { token })
  if (current.defaultFee !== null) return
  await api('/api/admin/shipping-fees', {
    method: 'PUT',
    token,
    body: { defaultFee: 30_000, freeShippingThreshold: null, provinceFees: [] },
  })
  console.log('Đã đặt phí giao mặc định 30.000đ')
}

async function main() {
  const existing = await fetch(`${BASE}/api/brands/nike`)
  if (existing.ok) {
    console.log('Đã có dữ liệu demo (thương hiệu nike), bỏ qua phần danh mục.')
    // Dữ liệu demo cũ (trước M3) chưa có phí giao: bổ sung để đặt mua được.
    const token = String((await api('/api/admin/auth/login', { method: 'POST', body: OWNER })).accessToken)
    await ensureShippingFee(token)
    console.log(`Đăng nhập quản trị: ${OWNER.email} / ${OWNER.password}`)
    return
  }

  execFileSync(
    'docker',
    [
      'compose',
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
    ],
    { stdio: 'inherit' },
  )
  const token = String((await api('/api/admin/auth/login', { method: 'POST', body: OWNER })).accessToken)

  const pageIds: Record<string, string> = {}
  for (const page of PAGES) {
    const created = await api('/api/admin/pages', { method: 'POST', token, body: page })
    await api(`/api/admin/pages/${created.id}/publish`, { method: 'POST', token })
    pageIds[page.slug] = String(created.id)
  }
  console.log(`Đã xuất bản ${PAGES.length} trang nội dung`)

  await api('/api/admin/legal-info', {
    method: 'PUT',
    token,
    body: {
      companyName: 'Công ty TNHH Atelier Demo',
      businessRegistrationNumber: '0318765432',
      businessRegistrationIssuedBy: 'Sở Kế hoạch và Đầu tư TP. Hồ Chí Minh',
      businessRegistrationIssuedOn: '2024-05-20',
      address: '123 Lê Lợi, phường Bến Thành, TP. Hồ Chí Minh',
      phone: '0281234567',
      email: 'lienhe@example.com',
      moitLogoUrl: '',
      moitNoticeUrl: '',
    },
  })
  await ensureShippingFee(token)

  const brandIds: Record<string, string> = {}
  for (const brand of BRANDS) {
    const created = await api('/api/admin/brands', { method: 'POST', token, body: brand })
    brandIds[brand.slug] = String(created.id)
    await upload(`/api/admin/brands/${created.id}/logo`, token, 'PUT', await logoImage(brand.name), 'logo.png')
  }
  console.log(`Đã tạo ${BRANDS.length} thương hiệu kèm logo`)

  const categoryIds: Record<string, string> = {}
  for (const parent of CATEGORIES) {
    const { children, ...body } = parent
    const created = await api('/api/admin/categories', { method: 'POST', token, body })
    for (const child of children) {
      const sub = await api('/api/admin/categories', {
        method: 'POST',
        token,
        body: { ...child, productType: parent.productType, parentId: created.id },
      })
      categoryIds[child.slug] = String(sub.id)
    }
  }
  console.log(`Đã tạo ${CATEGORIES.length} danh mục, mỗi danh mục hai danh mục con`)

  const types = (await api('/api/admin/commitment-types', { token })).items as { id: string; name: string }[]
  const warrantyType = types.find((type) => type.name === 'Bảo hành chính hãng')!

  for (const product of PRODUCTS) {
    const brandName = BRANDS.find((b) => b.slug === product.brand)!.name
    const created = await api('/api/admin/products', {
      method: 'POST',
      token,
      body: {
        brandId: brandIds[product.brand],
        categoryId: categoryIds[product.category],
        name: product.name,
        slug: product.slug,
        modelCode: product.modelCode,
        description: product.description,
        usageCare: product.usageCare,
        originStatement: `Nhập khẩu chính ngạch qua nhà phân phối ${brandName} tại châu Á, có tờ khai hải quan.`,
        attributes: product.attributes,
        groundShippingOnly: product.groundShippingOnly ?? false,
      },
    })
    const base = `/api/admin/products/${created.id}`

    const variants: { id: string; color: unknown }[] = []
    for (const variant of product.variants) {
      const v = await api(`${base}/variants`, { method: 'POST', token, body: variant })
      variants.push({ id: String(v.id), color: variant.attributes.mau })
    }

    for (const image of product.images) {
      const title = product.name.replace(`${brandName} `, '') + (image.color ? ` - ${image.color}` : '')
      // Font dùng để vẽ ảnh có thể thiếu dấu tiếng Việt, nên ghi không dấu.
      const plain = title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
      const file = await placeholderImage(brandName, plain, image.tint)
      const uploaded = await upload(`${base}/images`, token, 'POST', file, 'anh.png')
      const variantIds = image.color ? variants.filter((v) => v.color === image.color).map((v) => v.id) : []
      await api(`${base}/images/${uploaded.id}`, {
        method: 'PUT',
        token,
        body: { alt: `${product.name}${image.color ? ` màu ${image.color.toLowerCase()}` : ''}`, variantIds },
      })
    }

    await api(`${base}/policies`, {
      method: 'PUT',
      token,
      body: { pageIds: [pageIds['chinh-sach-doi-tra'], pageIds['chinh-sach-bao-hanh']] },
    })

    if (product.warranty) {
      const pdf = new Blob([Buffer.from('%PDF-1.7\n%%EOF\n')], { type: 'application/pdf' })
      const document = await upload(`${base}/documents`, token, 'POST', pdf, 'hoa-don-nhap-khau.pdf')
      await api(`${base}/commitments`, {
        method: 'POST',
        token,
        body: { typeId: warrantyType.id, statement: product.warranty, documentIds: [document.id] },
      })
    }

    await api(`${base}/status`, { method: 'PUT', token, body: { status: 'published' } })
    console.log(`Đã xuất bản ${product.name}`)
  }

  console.log(`\nXong. Website: ${BASE}  Quản trị: ${BASE}/admin/login`)
  console.log(`Đăng nhập quản trị: ${OWNER.email} / ${OWNER.password}`)
}

await main()
