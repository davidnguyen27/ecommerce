import { GENDER_KEY, GENDER_OPTIONS, ProductType, type ProductCard, type PublicProduct } from '@ecommerce/shared'
import type { LlmTool, LlmToolCall } from '../adapters/llm.ts'
import type { Storage } from '../adapters/storage.ts'
import { loadAttributeSchema } from '../catalog/attribute-schemas.ts'
import { findPublicProduct, searchProductCards } from '../catalog/public-products.ts'
import type { SearchCriteria } from '../catalog/search.ts'
import { findPublishedVersion, listPublishedPages } from '../content/pages.ts'
import type { Db } from '../db.ts'

// Công cụ của chatbot (spec M8 "Công cụ"): chỉ đọc, và chỉ đọc những gì web khách đã hiện. Sản phẩm đi qua đúng các hàm
// của trang sản phẩm công khai, nên không lộ bản nháp, số tồn, giá vốn hay chứng từ. Kết quả gửi cho model viết gọn để
// tiết kiệm token (ADR 0017).

export type ToolDeps = { prisma: Db; storage: Storage }

/** Kết quả một lời gọi công cụ: phần gửi lại cho model, và phần khung chat dùng (thẻ, đề nghị chuyển). */
export type ToolOutcome = { output: unknown; cards?: ProductCard[]; handoffSummary?: string }

/** Số sản phẩm tối đa mỗi lần tìm (spec M8). */
export const SEARCH_LIMIT = 5
/** Key thuộc tính màu trong schema của các nhóm hàng (dữ liệu hiện có). */
const COLOR_KEY = 'mau'
const DESCRIPTION_LIMIT = 600
const USAGE_CARE_LIMIT = 300
const POLICY_LIMIT = 4000

const object = (properties: Record<string, unknown> = {}, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

export const CHAT_TOOLS: LlmTool[] = [
  {
    name: 'search_products',
    description:
      'Tìm sản phẩm đang bán, tối đa 5. Loại hàng (túi, giày, đồng hồ…) dùng productType, màu dùng color, giới tính dùng gender, ngân sách dùng minPrice/maxPrice (đồng). text chỉ khớp tên mẫu, thương hiệu hay mã sản phẩm; để trống nếu khách không nêu tên mẫu.',
    parameters: object({
      text: { type: 'string', description: 'Tên mẫu, thương hiệu hay mã, ví dụ "Air Max", "Tabby"' },
      productType: {
        type: 'string',
        enum: ProductType.options,
        description: 'footwear: giày dép; apparel: quần áo; watch: đồng hồ; bag: túi; fragrance: nước hoa',
      },
      brand: { type: 'string', description: 'Tên thương hiệu' },
      color: { type: 'string', description: 'Màu bằng tiếng Việt, ví dụ "Đen", "Trắng"; chỉ dùng kèm productType' },
      gender: { type: 'string', enum: [...GENDER_OPTIONS] },
      minPrice: { type: 'integer' },
      maxPrice: { type: 'integer' },
    }),
  },
  {
    name: 'get_product',
    description:
      'Chi tiết một sản phẩm theo slug lấy từ search_products: biến thể kèm giá và tình trạng, bảng size, đợt đặt trước, nguồn gốc, cam kết, chính sách áp dụng.',
    parameters: object({ slug: { type: 'string' } }, ['slug']),
  },
  { name: 'list_policies', description: 'Danh sách trang chính sách của cửa hàng.', parameters: object() },
  {
    name: 'get_policy',
    description: 'Nội dung một trang chính sách theo slug lấy từ list_policies.',
    parameters: object({ slug: { type: 'string' } }, ['slug']),
  },
  {
    name: 'handoff',
    description:
      'Đề nghị chuyển khách sang nhân viên. Không gửi gì: khung chat hiện nút để khách tự xác nhận. Tóm tắt một câu khách cần gì.',
    parameters: object({ summary: { type: 'string' } }, ['summary']),
  },
]

type Args = Record<string, unknown>

const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text)
const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const int = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined)

const productUrl = (slug: string) => `/san-pham/${slug}`
const policyUrl = (slug: string) => `/trang/${slug}`

/** Tên thuộc tính thay cho key, để model đọc được ("Màu" thay vì `color`). */
function labelled(product: PublicProduct, values: Record<string, unknown>) {
  const labelOf = new Map(product.attributeSchema.map((a) => [a.key, a.label]))
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [labelOf.get(key) ?? key, value]))
}

/** Sản phẩm viết gọn cho model: không ảnh, không id biến thể; mô tả và hướng dẫn cắt ngắn. */
export function productForModel(product: PublicProduct) {
  return {
    slug: product.slug,
    url: productUrl(product.slug),
    name: product.name,
    brand: product.brand.name,
    description: cut(product.description, DESCRIPTION_LIMIT),
    usageCare: cut(product.usageCare, USAGE_CARE_LIMIT),
    attributes: labelled(product, product.attributes),
    variants: product.variants.map((variant) => ({
      attributes: labelled(product, variant.attributes),
      price: variant.price,
      availability: variant.availability,
      ...(variant.preorder && {
        preorder: {
          depositPercent: variant.preorder.depositPercent,
          expectedDelivery: `${variant.preorder.deliveryFrom} – ${variant.preorder.deliveryTo} (dự kiến)`,
        },
      }),
    })),
    sizeChart: product.sizeChart,
    originStatement: product.originStatement,
    commitments: product.commitments.map((c) => ({ type: c.type, statement: c.statement })),
    policies: product.policies.map((page) => ({ ...page, url: policyUrl(page.slug) })),
  }
}

async function searchProducts({ prisma, storage }: ToolDeps, args: Args): Promise<ToolOutcome> {
  let text = str(args.text)
  const brandName = str(args.brand)
  let brandSlug: string | undefined
  if (brandName) {
    const brand = await prisma.brand.findFirst({
      where: { OR: [{ slug: brandName.toLowerCase() }, { name: { equals: brandName, mode: 'insensitive' } }] },
      select: { slug: true },
    })
    // Thương hiệu không khớp tên nào thì tìm như một từ khóa, thay vì trả rỗng.
    if (brand) brandSlug = brand.slug
    else text = [brandName, text].filter(Boolean).join(' ')
  }
  const productType = ProductType.safeParse(args.productType)
  const type = productType.success ? productType.data : undefined
  const criteria: SearchCriteria = {
    text,
    brandSlug,
    productType: type,
    minPrice: int(args.minPrice),
    maxPrice: int(args.maxPrice),
    attributes: await attributeFilters(prisma, type, args),
  }
  let { items } = await searchProductCards(prisma, storage, criteria, undefined, 1, SEARCH_LIMIT)
  let note: string | undefined
  // Từ khóa chỉ khớp tên, thương hiệu, mã (tên sản phẩm phần lớn tiếng Anh): không khớp mà còn bộ lọc khác thì bỏ từ
  // khóa, để "túi đi làm dưới 7 triệu" vẫn ra túi trong ngân sách thay vì rỗng.
  const otherFilters =
    criteria.brandSlug || type || criteria.minPrice || criteria.maxPrice || criteria.attributes.length
  if (items.length === 0 && text && otherFilters) {
    items = (await searchProductCards(prisma, storage, { ...criteria, text: undefined }, undefined, 1, SEARCH_LIMIT))
      .items
    note = 'Không có sản phẩm khớp từ khóa; đây là các sản phẩm khớp các bộ lọc còn lại.'
  }
  return {
    output: {
      products: items.map((card) => ({
        slug: card.slug,
        url: productUrl(card.slug),
        name: card.name,
        brand: card.brand.name,
        fromPrice: card.fromPrice,
        availability: card.inStock ? 'in_stock' : card.preorder ? 'preorder' : 'out_of_stock',
      })),
      ...(note && { note }),
    },
    cards: items,
  }
}

/**
 * Bộ lọc màu và giới tính theo schema của nhóm hàng. Màu là thuộc tính `mau`, chỉ lọc được khi biết nhóm hàng; giá trị
 * lưu viết hoa chữ đầu ("Đen"). Giới tính lọc được ở mọi nhóm hàng (Nam, Nữ gồm cả Unisex).
 */
async function attributeFilters(prisma: Db, type: ProductType | undefined, args: Args) {
  const color = str(args.color)
  const gender = GENDER_OPTIONS.find((option) => option.toLowerCase() === str(args.gender)?.toLowerCase())
  if (!gender && !(color && type)) return []
  const schema = await loadAttributeSchema(prisma, type ?? ProductType.enum.footwear)
  const filters: SearchCriteria['attributes'] = []
  const genderDefinition = schema.attributes.find((a) => a.key === GENDER_KEY)
  if (gender && genderDefinition) filters.push({ definition: genderDefinition, values: [gender] })
  const colorDefinition = type ? schema.attributes.find((a) => a.key === COLOR_KEY && a.filterable) : undefined
  if (color && colorDefinition) {
    filters.push({ definition: colorDefinition, values: [color.charAt(0).toLocaleUpperCase('vi') + color.slice(1)] })
  }
  return filters
}

async function getProduct({ prisma, storage }: ToolDeps, args: Args): Promise<ToolOutcome> {
  const slug = str(args.slug)
  const product = slug ? await findPublicProduct(prisma, storage, slug) : null
  return { output: product ? productForModel(product) : { error: 'Không có sản phẩm này; tìm bằng search_products' } }
}

async function listPolicies({ prisma }: ToolDeps): Promise<ToolOutcome> {
  const pages = (await listPublishedPages(prisma)).filter((page) => page.kind === 'policy')
  return {
    output: {
      policies: pages.map((page) => ({ slug: page.slug, title: page.version.title, url: policyUrl(page.slug) })),
    },
  }
}

async function getPolicy({ prisma }: ToolDeps, args: Args): Promise<ToolOutcome> {
  const slug = str(args.slug)
  const version = slug ? await findPublishedVersion(prisma, slug) : null
  if (!version || version.page.kind !== 'policy') {
    return { output: { error: 'Không có trang chính sách này; xem list_policies' } }
  }
  return {
    output: {
      slug: version.page.slug,
      title: version.title,
      url: policyUrl(version.page.slug),
      body: cut(version.body, POLICY_LIMIT),
    },
  }
}

function handoff(args: Args): ToolOutcome {
  const summary = str(args.summary) ?? 'Khách muốn gặp nhân viên'
  return {
    output: { ok: true, note: 'Chưa gửi gì. Khung chat hiện nút để khách tự bấm xác nhận.' },
    handoffSummary: summary,
  }
}

/** Chạy một lời gọi công cụ. Tham số hỏng hay công cụ lạ thì báo lỗi cho model, không ném. */
export async function runTool(deps: ToolDeps, call: LlmToolCall): Promise<ToolOutcome> {
  let args: Args
  try {
    const parsed: unknown = JSON.parse(call.arguments || '{}')
    args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Args) : {}
  } catch {
    return { output: { error: 'Tham số không phải JSON hợp lệ' } }
  }
  switch (call.name) {
    case 'search_products':
      return searchProducts(deps, args)
    case 'get_product':
      return getProduct(deps, args)
    case 'list_policies':
      return listPolicies(deps)
    case 'get_policy':
      return getPolicy(deps, args)
    case 'handoff':
      return handoff(args)
    default:
      return { output: { error: `Không có công cụ ${call.name}` } }
  }
}
