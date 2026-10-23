<script setup lang="ts">
import { ATTRIBUTE_FILTER_PREFIX, ProductSearchResult, type AttributeFacet, type ProductSort } from '@ecommerce/shared'

/**
 * Danh sách sản phẩm có tìm kiếm, bộ lọc, sắp xếp và phân trang. Mọi lựa chọn nằm trên URL để chia sẻ được;
 * bộ lọc là form GET nên vẫn dùng được khi chưa có JavaScript.
 */
const props = defineProps<{
  /** Cố định theo trang đang mở, không nằm trên query. */
  category?: string
  brand?: string
  empty: string
}>()

const route = useRoute()
const { apiBase } = useRuntimeConfig()

const SORTS: { value: ProductSort | undefined; label: string }[] = [
  { value: undefined, label: 'Phù hợp' },
  { value: 'newest', label: 'Mới nhất' },
  { value: 'price_asc', label: 'Giá tăng dần' },
  { value: 'price_desc', label: 'Giá giảm dần' },
]

const values = (name: string) =>
  [route.query[name]].flat().filter((v): v is string => typeof v === 'string' && v !== '')
const first = (name: string) => values(name)[0] ?? ''

/** Tham số lọc đang có trên URL (không gồm trang). */
const filters = computed(() => {
  const query: Record<string, string[]> = {}
  for (const name of Object.keys(route.query)) {
    if (LISTING_FILTER_PARAMS.includes(name) || name.startsWith(ATTRIBUTE_FILTER_PREFIX)) {
      const list = values(name)
      if (list.length) query[name] = list
    }
  }
  return query
})
const page = computed(() => Number(route.query.trang) || 1)

const { data, error } = await useAsyncData(
  () => `products-${props.category ?? ''}-${props.brand ?? ''}-${JSON.stringify(filters.value)}-${page.value}`,
  async () => {
    const body = await $fetch('/api/products', {
      baseURL: apiBase,
      query: { ...filters.value, category: props.category, brand: props.brand, page: page.value },
    })
    return ProductSearchResult.parse(body)
  },
)

const activeCount = computed(() => Object.keys(filters.value).filter((name) => name !== 'q' && name !== 'sort').length)
const isSelected = (facet: AttributeFacet, value: string) => values(ATTRIBUTE_FILTER_PREFIX + facet.key).includes(value)
const valueLabel = (facet: AttributeFacet, value: string) => {
  if (facet.type === 'boolean') return value === 'true' ? 'Có' : 'Không'
  return facet.unit ? `${value} ${facet.unit}` : value
}

const sortLink = (sort: ProductSort | undefined) => ({ query: { ...route.query, sort, trang: undefined } })
const currentSort = computed(() => first('sort') || (filters.value.q ? undefined : 'newest'))
const clearLink = computed(() => ({ query: { q: first('q') || undefined, sort: first('sort') || undefined } }))

const open = ref(false)

/** Có JavaScript thì đổi URL tại chỗ thay vì tải lại trang; về trang 1 vì kết quả đã khác. */
function apply(event: Event) {
  const query: Record<string, string[]> = {}
  for (const [name, value] of new FormData(event.target as HTMLFormElement)) {
    if (typeof value === 'string' && value.trim() !== '') (query[name] ??= []).push(value.trim())
  }
  open.value = false
  return navigateTo({ path: route.path, query })
}
</script>

<template>
  <section class="search">
    <p v-if="error" role="alert">
      {{ (error as { statusCode?: number }).statusCode === 400 ? 'Bộ lọc không hợp lệ.' : 'Không tải được sản phẩm.' }}
    </p>
    <template v-else-if="data">
      <div class="toolbar">
        <p class="total">{{ data.total }} sản phẩm</p>
        <nav aria-label="Sắp xếp" class="sorts">
          <template v-for="sort in SORTS" :key="sort.label">
            <NuxtLink
              v-if="sort.value || filters.q"
              :to="sortLink(sort.value)"
              :aria-current="currentSort === sort.value ? 'true' : undefined"
              >{{ sort.label }}</NuxtLink
            >
          </template>
        </nav>
      </div>

      <details class="filters" :open="open" @toggle="open = ($event.target as HTMLDetailsElement).open">
        <summary>Bộ lọc{{ activeCount ? ` (${activeCount})` : '' }}</summary>
        <form method="get" :action="route.path" class="panel" @submit.prevent="apply">
          <header>
            <strong>Bộ lọc</strong>
            <button type="button" aria-label="Đóng bộ lọc" @click="open = false">✕</button>
          </header>
          <input v-if="filters.q" type="hidden" name="q" :value="first('q')" />
          <input v-if="filters.sort" type="hidden" name="sort" :value="first('sort')" />

          <fieldset v-if="!category && data.facets.productTypes.length">
            <legend>Nhóm hàng</legend>
            <label>
              <input type="radio" name="type" value="" :checked="!first('type')" />
              Tất cả
            </label>
            <label v-for="option in data.facets.productTypes" :key="option.productType">
              <input
                type="radio"
                name="type"
                :value="option.productType"
                :checked="first('type') === option.productType"
              />
              {{ PRODUCT_TYPE_LABELS[option.productType] }} ({{ option.count }})
            </label>
          </fieldset>

          <fieldset v-for="facet in data.facets.attributes" :key="facet.key">
            <legend>{{ facet.label }}</legend>
            <label v-for="option in facet.values" :key="option.value">
              <input
                type="checkbox"
                :name="ATTRIBUTE_FILTER_PREFIX + facet.key"
                :value="option.value"
                :checked="isSelected(facet, option.value)"
              />
              {{ valueLabel(facet, option.value) }} ({{ option.count }})
            </label>
            <!-- Giá trị đang chọn mà không còn sản phẩm vẫn hiện, để bỏ chọn được. -->
            <template v-for="value in values(ATTRIBUTE_FILTER_PREFIX + facet.key)" :key="`chon-${value}`">
              <label v-if="!facet.values.some((option) => option.value === value)">
                <input type="checkbox" :name="ATTRIBUTE_FILTER_PREFIX + facet.key" :value="value" checked />
                {{ valueLabel(facet, value) }} (0)
              </label>
            </template>
          </fieldset>

          <fieldset>
            <legend>Khoảng giá (₫)</legend>
            <div class="price">
              <input
                type="number"
                name="minPrice"
                min="0"
                step="1000"
                inputmode="numeric"
                aria-label="Giá từ"
                :placeholder="data.facets.price ? String(data.facets.price.min) : 'Từ'"
                :value="first('minPrice')"
              />
              <span>–</span>
              <input
                type="number"
                name="maxPrice"
                min="0"
                step="1000"
                inputmode="numeric"
                aria-label="Giá đến"
                :placeholder="data.facets.price ? String(data.facets.price.max) : 'Đến'"
                :value="first('maxPrice')"
              />
            </div>
          </fieldset>

          <footer>
            <NuxtLink :to="clearLink" @click="open = false">Xóa bộ lọc</NuxtLink>
            <button type="submit">Xem kết quả</button>
          </footer>
        </form>
      </details>

      <ProductCardGrid :list="data" :empty="empty" />
    </template>
  </section>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: baseline;
  justify-content: space-between;
}
.sorts {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.sorts [aria-current] {
  font-weight: 600;
}
.filters > summary {
  display: inline-block;
  padding: 8px 12px;
  border: 1px solid currentColor;
  border-radius: 4px;
  cursor: pointer;
}
/* Ngăn kéo trượt ra từ cạnh phải, vừa màn hình điện thoại; phần còn lại phủ tối. */
.panel {
  position: fixed;
  inset: 0 0 0 auto;
  z-index: 10;
  width: min(360px, 88vw);
  overflow-y: auto;
  padding: 16px;
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.4);
}
.panel header,
.panel footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel footer {
  position: sticky;
  bottom: -16px;
  padding: 12px 0;
  background: Canvas;
}
.panel fieldset {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
  border: 0;
  padding: 0;
}
.panel legend {
  font-weight: 600;
  margin-bottom: 4px;
}
.panel label {
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.price {
  display: flex;
  align-items: center;
  gap: 8px;
}
.price input {
  width: 100%;
  min-width: 0;
}
</style>
