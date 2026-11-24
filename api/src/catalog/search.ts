import {
  GENDER_KEY,
  GENDER_UNISEX,
  PRODUCT_PAGE_SIZE,
  ProductType,
  type AttributeDefinition,
  type AttributeFacet,
  type ProductSort,
} from '@ecommerce/shared'
import type { Db } from '../db.ts'
import { Prisma } from '../generated/prisma/client.ts'

/** One attribute filter: a product matches with at least one of the values. */
type AttributeFilter = { definition: AttributeDefinition; values: string[] }

export type SearchCriteria = {
  text?: string
  /** A category and all its descendants; empty means no products. */
  categoryIds?: string[]
  brandSlug?: string
  productType?: ProductType
  minPrice?: number
  maxPrice?: number
  attributes: AttributeFilter[]
}

/** A filter is skipped when counting its own facet, so customers still see the other options. */
type Except = { attribute?: string; price?: boolean; productType?: boolean }

/** SKU prefixes shorter than this match exactly only, so "da" does not pull every DA… SKU to the top. */
const SKU_PREFIX_MIN = 3

const FROM = Prisma.sql`FROM "product_search" s JOIN "product_version" v ON v."id" = s."version_id"`

/** Filtering Nam or Nữ includes Unisex (ADR 0004). */
function filterValues({ definition, values }: AttributeFilter) {
  if (definition.key !== GENDER_KEY) return values
  return values.some((v) => v !== GENDER_UNISEX) ? [...new Set([...values, GENDER_UNISEX])] : values
}

const matches = (json: Prisma.Sql, filter: AttributeFilter) =>
  Prisma.sql`"attribute_values"(${json}) && ${filterValues(filter)}::text[]`

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&')

function skuPatterns(text: string) {
  const sku = escapeLike(text.trim().toUpperCase())
  return { exact: `% ${sku} %`, prefix: sku.length >= SKU_PREFIX_MIN ? `% ${sku}%` : `% ${sku} %` }
}

/** Condition on one variant on sale (`x`, an element of `snapshot.variants`): price and variant attributes. */
function variantConditions(c: SearchCriteria, except: Except) {
  const conditions: Prisma.Sql[] = []
  if (!except.price && c.minPrice !== undefined) conditions.push(Prisma.sql`(x->>'price')::bigint >= ${c.minPrice}`)
  if (!except.price && c.maxPrice !== undefined) conditions.push(Prisma.sql`(x->>'price')::bigint <= ${c.maxPrice}`)
  for (const filter of c.attributes) {
    if (filter.definition.level !== 'variant' || filter.definition.key === except.attribute) continue
    conditions.push(matches(Prisma.sql`x->'attributes'->${filter.definition.key}::text`, filter))
  }
  return conditions
}

function conditions(c: SearchCriteria, except: Except = {}) {
  const where: Prisma.Sql[] = []
  if (c.text) {
    const { prefix } = skuPatterns(c.text)
    where.push(Prisma.sql`(
      s."tsv" @@ "search_prefix_query"(${c.text})
      OR "search_normalize"(${c.text}) <% s."document"
      OR s."skus" LIKE ${prefix}
    )`)
  }
  if (c.categoryIds) where.push(Prisma.sql`v."category_id" = ANY(${c.categoryIds}::uuid[])`)
  if (c.brandSlug !== undefined) {
    where.push(Prisma.sql`v."brand_id" IN (SELECT "id" FROM "brand" WHERE "slug" = ${c.brandSlug})`)
  }
  if (!except.productType && c.productType) {
    where.push(Prisma.sql`v."product_type" = ${c.productType}::"product_type"`)
  }
  for (const filter of c.attributes) {
    if (filter.definition.level !== 'product' || filter.definition.key === except.attribute) continue
    where.push(matches(Prisma.sql`v."snapshot"->'attributes'->${filter.definition.key}::text`, filter))
  }
  const variant = variantConditions(c, except)
  if (variant.length) {
    // Price and variant attributes must match on the same variant.
    where.push(Prisma.sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(v."snapshot"->'variants') x WHERE ${Prisma.join(variant, ' AND ')}
    )`)
  }
  return where
}

const whereOf = (where: Prisma.Sql[]) =>
  where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty

function orderBy(c: SearchCriteria, sort: ProductSort | undefined) {
  const order: Prisma.Sql[] = []
  if (c.text) {
    const { exact, prefix } = skuPatterns(c.text)
    order.push(Prisma.sql`CASE WHEN s."skus" LIKE ${exact} THEN 2 WHEN s."skus" LIKE ${prefix} THEN 1 ELSE 0 END DESC`)
  }
  // In stock first, from on-hand minus reserved of the live version's variants (ADR 0006, 0007).
  order.push(Prisma.sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements(v."snapshot"->'variants') x
    JOIN "product_variant" pv ON pv."id" = (x->>'id')::uuid
    WHERE pv."on_hand" - pv."reserved" > 0
  ) DESC`)
  if (sort === 'price_asc') order.push(Prisma.sql`v."from_price" ASC`)
  else if (sort === 'price_desc') order.push(Prisma.sql`v."from_price" DESC`)
  else if (c.text && !sort) {
    order.push(Prisma.sql`GREATEST(
      ts_rank(s."tsv", "search_prefix_query"(${c.text})),
      word_similarity("search_normalize"(${c.text}), s."document")
    ) DESC`)
  }
  order.push(Prisma.sql`v."published_at" DESC`, Prisma.sql`s."product_id" ASC`)
  return Prisma.join(order, ', ')
}

/** One page of matching live version ids in display order, with the total. */
export async function searchPage(
  db: Db,
  c: SearchCriteria,
  sort: ProductSort | undefined,
  page: number,
  pageSize = PRODUCT_PAGE_SIZE,
) {
  const [rows, [count]] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`
      SELECT v."id"::text AS id ${FROM} ${whereOf(conditions(c))}
      ORDER BY ${orderBy(c, sort)}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total ${FROM} ${whereOf(conditions(c))}`,
  ])
  return { versionIds: rows.map((r) => r.id), total: count!.total }
}

/** Product count per value of one attribute, keeping every filter except its own. */
async function attributeFacet(db: Db, c: SearchCriteria, definition: AttributeDefinition): Promise<AttributeFacet> {
  const except = { attribute: definition.key }
  const where = conditions(c, except)
  const rows =
    definition.level === 'product'
      ? await db.$queryRaw<{ value: string; count: number }[]>`
          SELECT f.val AS value, count(*)::int AS count ${FROM}
          CROSS JOIN LATERAL unnest("attribute_values"(v."snapshot"->'attributes'->${definition.key}::text)) f(val)
          ${whereOf(where)} GROUP BY f.val`
      : await db.$queryRaw<{ value: string; count: number }[]>`
          SELECT f.val AS value, count(DISTINCT s."product_id")::int AS count ${FROM}
          CROSS JOIN LATERAL jsonb_array_elements(v."snapshot"->'variants') x
          CROSS JOIN LATERAL unnest("attribute_values"(x->'attributes'->${definition.key}::text)) f(val)
          ${whereOf([...where, ...variantConditions(c, except)])} GROUP BY f.val`
  return {
    key: definition.key,
    label: definition.label,
    type: definition.type,
    unit: definition.type === 'number' ? definition.unit : null,
    values: sortValues(definition, rows),
  }
}

const collator = new Intl.Collator('vi', { numeric: true })

/** Enum values in schema order; others alphabetically, numbers by value (size 9 before 10). */
function sortValues(definition: AttributeDefinition, rows: { value: string; count: number }[]) {
  const options = 'options' in definition ? definition.options : []
  const rank = (value: string) => (options.includes(value) ? options.indexOf(value) : options.length)
  return rows
    .map(({ value, count }) => ({ value, count }))
    .sort((a, b) => rank(a.value) - rank(b.value) || collator.compare(a.value, b.value))
}

/** Result facets: product types, filterable attributes, price range. */
export async function searchFacets(db: Db, c: SearchCriteria, definitions: AttributeDefinition[]) {
  const [types, price, attributes] = await Promise.all([
    db.$queryRaw<{ productType: ProductType; count: number }[]>`
      SELECT v."product_type"::text AS "productType", count(*)::int AS count ${FROM}
      ${whereOf(conditions(c, { productType: true }))} GROUP BY 1`,
    db.$queryRaw<{ min: bigint | null; max: bigint | null }[]>`
      SELECT min((x->>'price')::bigint) AS min, max((x->>'price')::bigint) AS max ${FROM}
      CROSS JOIN LATERAL jsonb_array_elements(v."snapshot"->'variants') x
      ${whereOf([...conditions(c, { price: true }), ...variantConditions(c, { price: true })])}`,
    Promise.all(definitions.map((d) => attributeFacet(db, c, d))),
  ])
  const { min, max } = price[0]!
  return {
    productTypes: ProductType.options.flatMap((productType) => {
      const row = types.find((t) => t.productType === productType)
      return row ? [{ productType, count: row.count }] : []
    }),
    attributes,
    price: min === null || max === null ? null : { min: Number(min), max: Number(max) },
  }
}
