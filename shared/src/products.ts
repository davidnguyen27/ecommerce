import { z } from 'zod'
import { AttributeDefinition } from './attributes.ts'
import { ProductType } from './catalog.ts'
import { PublicCommitment } from './commitments.ts'
import { ImageRenditions } from './media.ts'
import { Slug } from './slug.ts'

export const ProductStatus = z.enum(['draft', 'published', 'archived'])
export type ProductStatus = z.infer<typeof ProductStatus>

/** Đang bán hoặc ngừng bán (GLOSSARY "Ngừng bán"). */
export const VariantStatus = z.enum(['active', 'discontinued'])
export type VariantStatus = z.infer<typeof VariantStatus>

const Cell = z.string().trim().max(200)

/** Bảng size: một hàng tiêu đề và các hàng dữ liệu cùng số cột. */
export const SizeChart = z
  .object({
    columns: z.array(Cell.min(1)).min(1).max(20),
    rows: z.array(z.array(Cell)).max(100),
  })
  .superRefine(({ columns, rows }, ctx) => {
    rows.forEach((row, index) => {
      if (row.length !== columns.length) {
        ctx.addIssue({ code: 'custom', path: ['rows', index], message: `Hàng phải có đúng ${columns.length} ô` })
      }
    })
  })
export type SizeChart = z.infer<typeof SizeChart>

const LongText = z.string().max(20_000).default('')

/** Phần soạn được của sản phẩm. Trạng thái không nằm ở đây: sản phẩm mới luôn là nháp. */
export const ProductRequest = z.object({
  brandId: z.uuid(),
  /** Nhóm hàng lấy từ danh mục lúc tạo; về sau chỉ đổi được sang danh mục cùng nhóm hàng. */
  categoryId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  slug: Slug,
  modelCode: z.string().trim().max(100).default(''),
  description: LongText,
  /** Hướng dẫn sử dụng và bảo quản. */
  usageCare: LongText,
  sizeChart: SizeChart.nullable().default(null),
  /** Thông tin nguồn gốc công bố; bảo hành chỉ là cam kết có bằng chứng (ADR 0005). */
  originStatement: LongText,
  /** Thuộc tính cấp sản phẩm, kiểm theo schema của nhóm hàng. */
  attributes: z.record(z.string(), z.unknown()).default({}),
  groundShippingOnly: z.boolean().default(false),
})
export type ProductRequest = z.input<typeof ProductRequest>

/** Giá VND đã gồm VAT, số nguyên dương. */
const Price = z.number().int('Giá phải là số nguyên VND').positive('Giá phải lớn hơn 0').max(1_000_000_000_000)

/** SKU lưu chữ hoa, để `abc-1` và `ABC-1` không thành hai SKU. */
export const Sku = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'SKU chỉ gồm chữ không dấu, số, dấu chấm, gạch ngang, gạch dưới')
  .transform((sku) => sku.toUpperCase())

/**
 * Biến thể. `price`, `compareAtPrice` bỏ qua thì giữ nguyên; gửi kèm giá khác giá hiện tại cần `price.edit`.
 * Giá hãng để trống hoặc không thấp hơn giá bán.
 */
export const VariantRequest = z.object({
  sku: Sku,
  attributes: z.record(z.string(), z.unknown()).default({}),
  status: VariantStatus.default('active'),
  /** Bỏ qua khi tạo thì xếp cuối. */
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  price: Price.nullable().optional(),
  compareAtPrice: Price.nullable().optional(),
})
export type VariantRequest = z.input<typeof VariantRequest>

const AttributeValues = z.record(z.string(), z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]))

export const AdminVariant = z.object({
  id: z.string(),
  sku: z.string(),
  attributes: AttributeValues,
  price: z.number().nullable(),
  compareAtPrice: z.number().nullable(),
  status: VariantStatus,
  sortOrder: z.number(),
})
export type AdminVariant = z.infer<typeof AdminVariant>

export const AdminProduct = z.object({
  id: z.string(),
  productType: ProductType,
  brandId: z.string(),
  categoryId: z.string(),
  name: z.string(),
  slug: z.string(),
  modelCode: z.string(),
  description: z.string(),
  usageCare: z.string(),
  sizeChart: SizeChart.nullable(),
  originStatement: z.string(),
  attributes: AttributeValues,
  groundShippingOnly: z.boolean(),
  status: ProductStatus,
  updatedAt: z.string(),
  /** Xếp theo thứ tự hiển thị. */
  variants: z.array(AdminVariant),
})
export type AdminProduct = z.infer<typeof AdminProduct>

const Ref = z.object({ id: z.string(), name: z.string() })

export const AdminProductSummary = z.object({
  id: z.string(),
  productType: ProductType,
  name: z.string(),
  slug: z.string(),
  modelCode: z.string(),
  brand: Ref,
  category: Ref,
  status: ProductStatus,
  variantCount: z.number(),
  updatedAt: z.string(),
})
export type AdminProductSummary = z.infer<typeof AdminProductSummary>

export const AdminProductList = z.object({ items: z.array(AdminProductSummary) })
export type AdminProductList = z.infer<typeof AdminProductList>

// Vòng đời và xuất bản

/**
 * Chuyển trạng thái: Nháp → Đã xuất bản, Nháp → Lưu trữ, Đã xuất bản → Lưu trữ, Lưu trữ → Nháp.
 * Gửi `published` khi đang xuất bản là xuất bản lại các thay đổi.
 */
export const ChangeProductStatusRequest = z.object({ status: ProductStatus })
export type ChangeProductStatusRequest = z.infer<typeof ChangeProductStatusRequest>

/** Trang chính sách áp dụng cho sản phẩm, thay cả danh sách. */
export const ProductPoliciesRequest = z.object({ pageIds: z.array(z.uuid()).max(50) })
export type ProductPoliciesRequest = z.infer<typeof ProductPoliciesRequest>

/** Trang chính sách để chọn gắn vào sản phẩm; người soạn sản phẩm không cần quyền soạn nội dung. */
export const PolicyPageOptionList = z.object({
  items: z.array(z.object({ id: z.string(), slug: z.string(), title: z.string(), published: z.boolean() })),
})
export type PolicyPageOptionList = z.infer<typeof PolicyPageOptionList>

export const AdminProductDetail = AdminProduct.extend({
  /** Như `AdminProduct.variants`, kèm tồn trong kho (chỉ đọc; đổi tồn qua `/api/admin/stock`). */
  variants: z.array(AdminVariant.extend({ onHand: z.number() })),
  /** Trang chính sách đã gắn, kể cả trang chưa xuất bản (khách chỉ thấy trang đã xuất bản). */
  policyPageIds: z.array(z.string()),
  /** Phiên bản khách đang thấy; `null` khi sản phẩm không ở trạng thái đã xuất bản. */
  liveVersion: z.object({ version: z.number(), publishedAt: z.string() }).nullable(),
  /** Bản đang soạn khác phiên bản khách đang thấy; chỉ có nghĩa khi đã xuất bản. */
  hasUnpublishedChanges: z.boolean(),
})
export type AdminProductDetail = z.infer<typeof AdminProductDetail>

// Website

const PublicImage = ImageRenditions.extend({ alt: z.string() })
export type PublicImage = z.infer<typeof PublicImage>

/** Thẻ sản phẩm ở trang danh mục, thương hiệu. */
export const ProductCard = z.object({
  slug: z.string(),
  name: z.string(),
  brand: z.object({ slug: z.string(), name: z.string() }),
  /** Giá thấp nhất trong các biến thể đang bán ("từ X ₫"). */
  fromPrice: z.number(),
  /** Giá hãng của chính biến thể có giá thấp nhất. */
  compareAtPrice: z.number().nullable(),
  image: PublicImage.nullable(),
})
export type ProductCard = z.infer<typeof ProductCard>

export const PRODUCT_PAGE_SIZE = 24

/** Sắp xếp kết quả; bỏ trống thì có từ khóa xếp theo độ liên quan, không có thì mới xuất bản trước. */
export const ProductSort = z.enum(['newest', 'price_asc', 'price_desc'])
export type ProductSort = z.infer<typeof ProductSort>

/** Bộ lọc thuộc tính trên URL là `attr.<key>=<giá trị>`, lặp lại để chọn nhiều giá trị (ví dụ `attr.gioi_tinh=Nam`). */
export const ATTRIBUTE_FILTER_PREFIX = 'attr.'

/** Ô bỏ trống trên form gửi lên chuỗi rỗng; coi như không lọc. */
const blank = (value: unknown) => (value === '' ? undefined : value)
const QueryText = z.preprocess(blank, z.string().trim().max(200).optional())
const PriceBound = z.preprocess(blank, z.coerce.number().int().min(0).max(1_000_000_000_000).optional())
const FilterValues = z
  .union([z.string(), z.array(z.string())])
  .transform((values) =>
    [values]
      .flat()
      .map((v) => v.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().max(100)).max(50))

export const ProductListQuery = z.object({
  /** Từ khóa: tên sản phẩm, tên thương hiệu, mã mẫu (không dấu, sai chính tả nhẹ) hoặc SKU. */
  q: QueryText,
  /** Slug danh mục; gồm cả sản phẩm ở các danh mục con. */
  category: QueryText,
  /** Slug thương hiệu. */
  brand: QueryText,
  /** Nhóm hàng; ở trang danh mục thì nhóm hàng lấy từ danh mục. */
  type: z.preprocess(blank, ProductType.optional()),
  /** Khoảng giá VND, so trên giá các biến thể đang bán. */
  minPrice: PriceBound,
  maxPrice: PriceBound,
  sort: z.preprocess(blank, ProductSort.optional()),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  /** Key thuộc tính → các giá trị chọn, gom từ `attr.<key>` bằng `attributeFiltersOf`. */
  attributes: z.record(z.string(), FilterValues).default({}),
})
export type ProductListQuery = z.input<typeof ProductListQuery>

/** Gom các tham số `attr.<key>` của query string thành `{ key: giá trị }`. */
export function attributeFiltersOf(query: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([name]) => name.startsWith(ATTRIBUTE_FILTER_PREFIX))
      .map(([name, value]) => [name.slice(ATTRIBUTE_FILTER_PREFIX.length), value]),
  )
}

/** Sản phẩm đã xuất bản, một trang. */
export const ProductCardList = z.object({
  items: z.array(ProductCard),
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
})
export type ProductCardList = z.infer<typeof ProductCardList>

/** Một bộ lọc thuộc tính và số sản phẩm của từng giá trị khi giữ nguyên mọi bộ lọc khác. */
export const AttributeFacet = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['enum', 'multi_enum', 'text', 'number', 'boolean']),
  unit: z.string().nullable(),
  values: z.array(z.object({ value: z.string(), count: z.number() })),
})
export type AttributeFacet = z.infer<typeof AttributeFacet>

/** Kết quả tìm kiếm và lọc: một trang thẻ sản phẩm kèm facets. */
export const ProductSearchResult = ProductCardList.extend({
  /** Nhóm hàng đang xem (theo `type` hoặc danh mục); `null` thì chỉ lọc được giới tính, chung cho mọi nhóm hàng. */
  productType: ProductType.nullable(),
  facets: z.object({
    /** Số sản phẩm của từng nhóm hàng, để thu hẹp khi chưa chọn nhóm hàng. */
    productTypes: z.array(z.object({ productType: ProductType, count: z.number() })),
    /** Thuộc tính có `filterable` của nhóm hàng đang xem, theo thứ tự trong schema. */
    attributes: z.array(AttributeFacet),
    /** Giá thấp nhất và cao nhất trong các biến thể đang bán; `null` khi không có sản phẩm. */
    price: z.object({ min: z.number(), max: z.number() }).nullable(),
  }),
})
export type ProductSearchResult = z.infer<typeof ProductSearchResult>

/** Phiên bản đang xuất bản của sản phẩm, như khách thấy. */
export const PublicProduct = z.object({
  slug: z.string(),
  name: z.string(),
  productType: ProductType,
  /** `slug` là `null` khi thương hiệu đang ẩn (không có trang riêng). */
  brand: z.object({ slug: z.string().nullable(), name: z.string() }),
  /** `null` khi danh mục đang ẩn. */
  category: z.object({ slug: z.string(), name: z.string() }).nullable(),
  modelCode: z.string(),
  description: z.string(),
  usageCare: z.string(),
  sizeChart: SizeChart.nullable(),
  originStatement: z.string(),
  attributes: AttributeValues,
  groundShippingOnly: z.boolean(),
  /** Định nghĩa thuộc tính của nhóm hàng, để hiển thị nhãn. */
  attributeSchema: z.array(AttributeDefinition),
  /** Chỉ biến thể đang bán, theo thứ tự hiển thị. */
  variants: z.array(
    z.object({
      sku: z.string(),
      attributes: AttributeValues,
      price: z.number(),
      compareAtPrice: z.number().nullable(),
    }),
  ),
  /** Theo thứ tự hiển thị; `skus` rỗng là ảnh chung. */
  images: z.array(PublicImage.extend({ skus: z.array(z.string()) })),
  /** Trang chính sách áp dụng đã xuất bản. */
  policies: z.array(z.object({ slug: z.string(), title: z.string() })),
  /**
   * Cam kết có bằng chứng, tách khỏi thông tin nguồn gốc công bố; bảo hành chỉ có ở đây (ADR 0005).
   * Đọc trực tiếp, không qua phiên bản xuất bản: cam kết có quyền riêng và chứng từ làm căn cứ.
   */
  commitments: z.array(PublicCommitment),
  publishedAt: z.string(),
})
export type PublicProduct = z.infer<typeof PublicProduct>
