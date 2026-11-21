import {
  GENDER_KEY,
  GENDER_OPTIONS,
  GENDER_UNISEX,
  ProductType,
  type ProductCard,
  type PublicProduct,
  type VariantAvailability,
} from '@ecommerce/shared'
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
const DESCRIPTION_LIMIT = 400
const USAGE_CARE_LIMIT = 200
const POLICY_LIMIT = 4000

// Schema tối thiểu: mỗi khóa thừa (`additionalProperties`, `required` rỗng) tốn token ở mọi lần gọi, nhất là với qwen.
const object = (properties: Record<string, unknown>, required?: string[]) => ({
  type: 'object',
  properties,
  ...(required && { required }),
})

/**
 * Mô tả từng công cụ gửi cho model; mỗi tên phải có hàm chạy trong `RUNNERS` và ngược lại (typecheck). Tiếng Anh, gọn:
 * gửi kèm mọi lần gọi model (xem `SYSTEM_PROMPT`).
 */
const TOOL_DEFINITIONS: Record<ChatToolName, Omit<LlmTool, 'name'>> = {
  search_products: {
    description: 'Find products on sale (max 5). text matches only model, brand or SKU; leave empty otherwise.',
    parameters: object({
      text: { type: 'string' },
      productType: { type: 'string', enum: ProductType.options },
      brand: { type: 'string' },
      color: { type: 'string' },
      // Nam, Nữ đã gồm Unisex khi lọc (ADR 0004); cho chọn Unisex thì model hay tự thêm và loại mất hàng Nam, Nữ.
      gender: { type: 'string', enum: ['Nam', 'Nữ'] },
      minPrice: { type: 'integer' },
      maxPrice: { type: 'integer' },
    }),
  },
  get_product: {
    description:
      'Product details by slug, or by name if no slug: variants, size chart, pre-order, origin, commitments.',
    parameters: object({ slug: { type: 'string' }, name: { type: 'string' } }),
  },
  get_policy: {
    description: 'Policy page by slug.',
    parameters: object({ slug: { type: 'string' } }, ['slug']),
  },
  handoff: {
    description: 'Offer to pass the customer to staff; the customer confirms. summary: one line of what they need.',
    parameters: object({ summary: { type: 'string' } }, ['summary']),
  },
}

export const CHAT_TOOLS: LlmTool[] = Object.entries(TOOL_DEFINITIONS).map(([name, tool]) => ({ name, ...tool }))

/** Tình trạng bằng chữ thường: mã như `in_stock` thì model hay chép nguyên vào câu trả lời. */
const AVAILABILITY_TEXT: Record<VariantAvailability, string> = {
  in_stock: 'in stock',
  out_of_stock: 'out of stock',
  preorder: 'pre-order',
}

type Args = Record<string, unknown>

const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text)
const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const int = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined)

/** Tên thuộc tính thay cho key, để model đọc được ("Màu" thay vì `color`). */
function labelled(product: PublicProduct, values: Record<string, unknown>) {
  const labelOf = new Map(product.attributeSchema.map((a) => [a.key, a.label]))
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [labelOf.get(key) ?? key, value]))
}

/** Sản phẩm viết gọn cho model: không ảnh, không id biến thể, không URL (prompt nêu cách dựng link); mô tả cắt ngắn. */
export function productForModel(product: PublicProduct) {
  return {
    slug: product.slug,
    name: product.name,
    brand: product.brand.name,
    description: cut(product.description, DESCRIPTION_LIMIT),
    usageCare: cut(product.usageCare, USAGE_CARE_LIMIT),
    attributes: labelled(product, product.attributes),
    // Một dòng mỗi biến thể ("Đen / 41: 3490000 in_stock"): object có nhãn lặp lại ở mọi biến thể tốn token gấp mấy lần.
    variants: product.variants.map((variant) => {
      const preorder = variant.preorder
        ? ` (cọc ${variant.preorder.depositPercent}%, dự kiến ${variant.preorder.deliveryFrom} – ${variant.preorder.deliveryTo})`
        : ''
      return `${Object.values(variant.attributes).join(' / ')}: ${variant.price} ${AVAILABILITY_TEXT[variant.availability]}${preorder}`
    }),
    // "none" thay cho null: chạy thử thì gpt-oss bỏ qua null và tự đoán size "theo bảng đo chuẩn EU".
    sizeChart: product.sizeChart ?? 'none',
    originStatement: product.originStatement,
    commitments: product.commitments.map((c) => ({ type: c.type, statement: c.statement })),
    policies: product.policies.map((page) => page.slug),
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
    note = 'No match for text; these match the other filters.'
  }
  return {
    output: {
      products: items.map((card) => ({
        slug: card.slug,
        name: card.name,
        brand: card.brand.name,
        fromPrice: card.fromPrice,
        availability: AVAILABILITY_TEXT[card.inStock ? 'in_stock' : card.preorder ? 'preorder' : 'out_of_stock'],
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
  const gender = GENDER_OPTIONS.find(
    (option) => option !== GENDER_UNISEX && option.toLowerCase() === str(args.gender)?.toLowerCase(),
  )
  if (!gender && !(color && type)) return []
  // Chưa biết nhóm hàng thì chỉ lọc giới tính, mà giới tính có ở mọi nhóm hàng với cùng định nghĩa (ADR 0004): nạp
  // schema nhóm nào cũng được, như trang tìm kiếm của web.
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

/**
 * Chi tiết theo slug; không có slug (hay slug sai) mà có tên thì lấy sản phẩm khớp tên nhất. Câu như "túi Coach Tabby có
 * bảo hành không" khỏi phải tìm trước rồi mới xem chi tiết: bớt một lượt gọi model.
 */
async function getProduct({ prisma, storage }: ToolDeps, args: Args): Promise<ToolOutcome> {
  const slug = str(args.slug)
  const name = str(args.name)
  let product = slug ? await findPublicProduct(prisma, storage, slug) : null
  if (!product && name) {
    const [best] = (await searchProductCards(prisma, storage, { text: name, attributes: [] }, undefined, 1, 1)).items
    product = best ? await findPublicProduct(prisma, storage, best.slug) : null
  }
  return { output: product ? productForModel(product) : { error: 'Not found; try search_products' } }
}

/** Slug các trang chính sách đã xuất bản, cho dòng "Policy slugs" của prompt (thay công cụ liệt kê, bớt một lượt gọi). */
export async function policySlugs(prisma: Db) {
  return (await listPublishedPages(prisma)).filter((page) => page.kind === 'policy').map((page) => page.slug)
}

async function getPolicy({ prisma }: ToolDeps, args: Args): Promise<ToolOutcome> {
  const slug = str(args.slug)
  const version = slug ? await findPublishedVersion(prisma, slug) : null
  if (!version || version.page.kind !== 'policy') {
    return { output: { error: 'Unknown policy slug; see Policy slugs' } }
  }
  return {
    output: {
      slug: version.page.slug,
      title: version.title,
      body: cut(version.body, POLICY_LIMIT),
    },
  }
}

function handoff(args: Args): ToolOutcome {
  const summary = str(args.summary) ?? 'Khách muốn gặp nhân viên'
  return {
    output: { ok: true, note: 'Nothing sent yet; the customer must press confirm.' },
    handoffSummary: summary,
  }
}

type ToolRunner = (deps: ToolDeps, args: Args) => Promise<ToolOutcome> | ToolOutcome

/** Hàm chạy của từng công cụ, theo tên model gọi. */
const RUNNERS = {
  search_products: searchProducts,
  get_product: getProduct,
  get_policy: getPolicy,
  handoff: (_deps, args) => handoff(args),
} satisfies Record<string, ToolRunner>

export type ChatToolName = keyof typeof RUNNERS

/** Chạy một lời gọi công cụ. Tham số hỏng hay công cụ lạ thì báo lỗi cho model, không ném. */
export async function runTool(deps: ToolDeps, call: LlmToolCall): Promise<ToolOutcome> {
  let args: Args
  try {
    const parsed: unknown = JSON.parse(call.arguments || '{}')
    args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Args) : {}
  } catch {
    return { output: { error: 'Tham số không phải JSON hợp lệ' } }
  }
  const run = call.name in RUNNERS ? RUNNERS[call.name as ChatToolName] : undefined
  return run ? run(deps, args) : { output: { error: `Không có công cụ ${call.name}` } }
}
