import {
  GENDER_KEY,
  GENDER_OPTIONS,
  GENDER_UNISEX,
  ProductType,
  type ProductCard,
  type PublicProduct,
  type VariantAvailability,
} from '@ecommerce/shared'
import type { LlmTool, LlmToolCall } from '../../core/adapters/llm.ts'
import type { IAttributeSchemaQuery } from '../attribute-schema/index.ts'
import type { IProductQuery, SearchCriteria } from '../product/index.ts'
import { findPublishedVersion, listPublishedPages } from '../content-page/index.ts'
import type { Db } from '../../core/db.ts'

// Chatbot tools (spec M8 "Công cụ"): read-only, and only what the customer website already shows. Products go through
// the public product page functions, so drafts, stock counts, costs and documents never leak. Results sent to the
// model are terse to save tokens (ADR 0017).

/** The customer product reads and the attribute schemas, from their modules. */
export type ToolDeps = {
  prisma: Db
  products: Pick<IProductQuery, 'findPublicProduct' | 'searchProductCards'>
  schemas: Pick<IAttributeSchemaQuery, 'load'>
}

/** A tool call's result: what goes back to the model, and what the chat UI uses (cards, handoff offer). */
export type ToolOutcome = { output: unknown; cards?: ProductCard[]; handoffSummary?: string }

/** Max products per search (spec M8). */
export const SEARCH_LIMIT = 5
/** Color attribute key in product type schemas (current data). */
const COLOR_KEY = 'mau'
const DESCRIPTION_LIMIT = 400
const USAGE_CARE_LIMIT = 200
const POLICY_LIMIT = 4000

// Minimal schemas: every extra key (`additionalProperties`, empty `required`) costs tokens on every call, esp. qwen.
const object = (properties: Record<string, unknown>, required?: string[]) => ({
  type: 'object',
  properties,
  ...(required && { required }),
})

/**
 * Tool descriptions sent to the model; each name must have a runner in `RUNNERS` and vice versa (typecheck). English
 * and terse: sent with every call (see `SYSTEM_PROMPT`).
 */
const TOOL_DEFINITIONS: Record<ChatToolName, Omit<LlmTool, 'name'>> = {
  search_products: {
    description: 'Find products on sale (max 5). text matches only model, brand or SKU; leave empty otherwise.',
    parameters: object({
      text: { type: 'string' },
      productType: { type: 'string', enum: ProductType.options },
      brand: { type: 'string' },
      color: { type: 'string' },
      // Nam and Nữ already include Unisex (ADR 0004); offering Unisex made the model add it and drop Nam/Nữ items.
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

/** Status in plain words: codes like `in_stock` get copied verbatim into answers. */
const AVAILABILITY_TEXT: Record<VariantAvailability, string> = {
  in_stock: 'in stock',
  out_of_stock: 'out of stock',
  preorder: 'pre-order',
}

type Args = Record<string, unknown>

const cut = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text)
const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
const int = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined)

/** Attribute names instead of keys, so the model can read them ("Màu" rather than `color`). */
function labelled(product: PublicProduct, values: Record<string, unknown>) {
  const labelOf = new Map(product.attributeSchema.map((a) => [a.key, a.label]))
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [labelOf.get(key) ?? key, value]))
}

/**
 * Terse product for the model: no images, variant ids or URLs (the prompt says how to build links); short description.
 */
export function productForModel(product: PublicProduct) {
  return {
    slug: product.slug,
    name: product.name,
    brand: product.brand.name,
    description: cut(product.description, DESCRIPTION_LIMIT),
    usageCare: cut(product.usageCare, USAGE_CARE_LIMIT),
    attributes: labelled(product, product.attributes),
    // One line per variant ("Đen / 41: 3490000 in_stock"): objects repeating labels per variant cost several times
    // more.
    variants: product.variants.map((variant) => {
      const preorder = variant.preorder
        ? ` (cọc ${variant.preorder.depositPercent}%, dự kiến ${variant.preorder.deliveryFrom} – ${variant.preorder.deliveryTo})`
        : ''
      return `${Object.values(variant.attributes).join(' / ')}: ${variant.price} ${AVAILABILITY_TEXT[variant.availability]}${preorder}`
    }),
    // "none" instead of null: in trials gpt-oss ignored null and guessed sizes "theo bảng đo chuẩn EU".
    sizeChart: product.sizeChart ?? 'none',
    originStatement: product.originStatement,
    commitments: product.commitments.map((c) => ({ type: c.type, statement: c.statement })),
    policies: product.policies.map((page) => page.slug),
  }
}

async function searchProducts({ prisma, products, schemas }: ToolDeps, args: Args): Promise<ToolOutcome> {
  let text = str(args.text)
  const brandName = str(args.brand)
  let brandSlug: string | undefined
  if (brandName) {
    const brand = await prisma.brand.findFirst({
      where: { OR: [{ slug: brandName.toLowerCase() }, { name: { equals: brandName, mode: 'insensitive' } }] },
      select: { slug: true },
    })
    // A brand that matches no name is searched as a keyword instead of returning nothing.
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
    attributes: await attributeFilters(prisma, schemas, type, args),
  }
  let { items } = await products.searchProductCards(criteria, undefined, 1, SEARCH_LIMIT)
  let note: string | undefined
  // Keywords only match name, brand and code (names are mostly English): with no match but other filters, drop the
  // keyword so "túi đi làm dưới 7 triệu" still finds bags in budget instead of nothing.
  const otherFilters =
    criteria.brandSlug || type || criteria.minPrice || criteria.maxPrice || criteria.attributes.length
  if (items.length === 0 && text && otherFilters) {
    items = (await products.searchProductCards({ ...criteria, text: undefined }, undefined, 1, SEARCH_LIMIT)).items
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
 * Color and gender filters from the product type schema. Color is the `mau` attribute, filterable only when the type
 * is known; values are capitalized ("Đen"). Gender works on every type (Nam and Nữ include Unisex).
 */
async function attributeFilters(prisma: Db, schemas: ToolDeps['schemas'], type: ProductType | undefined, args: Args) {
  const color = str(args.color)
  const gender = GENDER_OPTIONS.find(
    (option) => option !== GENDER_UNISEX && option.toLowerCase() === str(args.gender)?.toLowerCase(),
  )
  if (!gender && !(color && type)) return []
  // With no product type, filter only by gender, which every type defines the same way (ADR 0004): any type's schema
  // works, as on the website search page.
  const schema = await schemas.load(prisma, type ?? ProductType.enum.footwear)
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
 * Details by slug; without a (valid) slug but with a name, takes the best name match. A question like "túi Coach Tabby
 * có bảo hành không" then needs no prior search: one less model call.
 */
async function getProduct({ products }: ToolDeps, args: Args): Promise<ToolOutcome> {
  const slug = str(args.slug)
  const name = str(args.name)
  let product = slug ? await products.findPublicProduct(slug) : null
  if (!product && name) {
    const [best] = (await products.searchProductCards({ text: name, attributes: [] }, undefined, 1, 1)).items
    product = best ? await products.findPublicProduct(best.slug) : null
  }
  return { output: product ? productForModel(product) : { error: 'Not found; try search_products' } }
}

/** Published policy page slugs, for the prompt's "Policy slugs" line (instead of a listing tool: one less call). */
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

/** Runner for each tool, by the name the model calls. */
const RUNNERS = {
  search_products: searchProducts,
  get_product: getProduct,
  get_policy: getPolicy,
  handoff: (_deps, args) => handoff(args),
} satisfies Record<string, ToolRunner>

export type ChatToolName = keyof typeof RUNNERS

/** Runs one tool call. Bad arguments or unknown tools report an error to the model instead of throwing. */
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
