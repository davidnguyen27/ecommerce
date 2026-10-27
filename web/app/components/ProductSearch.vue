<script setup lang="ts">
import { ATTRIBUTE_FILTER_PREFIX, ProductSearchResult, type AttributeFacet, type ProductSort } from '@ecommerce/shared'
import { SlidersHorizontal, X } from 'lucide-vue-next'

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
  <section>
    <p v-if="error" role="alert" class="notice-error">
      {{ (error as { statusCode?: number }).statusCode === 400 ? 'Bộ lọc không hợp lệ.' : 'Không tải được sản phẩm.' }}
    </p>
    <template v-else-if="data">
      <div class="mb-8 flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
        <p class="text-sm tabular-nums text-muted-foreground">{{ data.total }} sản phẩm</p>
        <div class="flex flex-wrap items-center gap-2">
          <nav aria-label="Sắp xếp" class="flex flex-wrap gap-1 text-sm">
            <template v-for="sort in SORTS" :key="sort.label">
              <NuxtLink
                v-if="sort.value || filters.q"
                :to="sortLink(sort.value)"
                :aria-current="currentSort === sort.value ? 'true' : undefined"
                class="inline-flex h-10 items-center rounded-md px-3 text-muted-foreground transition-colors hover:text-foreground aria-[current]:bg-secondary aria-[current]:font-semibold aria-[current]:text-foreground"
                >{{ sort.label }}</NuxtLink
              >
            </template>
          </nav>

          <details :open="open" @toggle="open = ($event.target as HTMLDetailsElement).open">
            <summary
              class="inline-flex h-10 cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium transition-colors hover:border-foreground [&::-webkit-details-marker]:hidden"
            >
              <SlidersHorizontal class="h-4 w-4" aria-hidden="true" />
              Bộ lọc{{ activeCount ? ` (${activeCount})` : '' }}
            </summary>
            <!-- Ngăn kéo trượt ra từ cạnh phải, vừa màn hình điện thoại; phần còn lại phủ tối. -->
            <form
              method="get"
              :action="route.path"
              class="fixed inset-y-0 right-0 z-50 flex w-[min(380px,90vw)] flex-col bg-card shadow-[0_0_0_100vmax_rgb(0_0_0/0.45)]"
              @submit.prevent="apply"
            >
              <header class="flex items-center justify-between border-b border-border px-5 py-4">
                <strong class="font-display text-lg font-semibold">Bộ lọc</strong>
                <button
                  type="button"
                  aria-label="Đóng bộ lọc"
                  class="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-secondary"
                  @click="open = false"
                >
                  <X class="h-5 w-5" aria-hidden="true" />
                </button>
              </header>
              <input v-if="filters.q" type="hidden" name="q" :value="first('q')" />
              <input v-if="filters.sort" type="hidden" name="sort" :value="first('sort')" />

              <div class="flex-1 divide-y divide-border overflow-y-auto px-5">
                <fieldset v-if="!category && data.facets.productTypes.length" class="pb-5">
                  <legend class="float-left mb-3 w-full pt-5 text-sm font-semibold">Nhóm hàng</legend>
                  <div class="clear-both space-y-1">
                    <label class="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
                      <input
                        type="radio"
                        name="type"
                        value=""
                        :checked="!first('type')"
                        class="h-4 w-4 accent-primary"
                      />
                      Tất cả
                    </label>
                    <label
                      v-for="option in data.facets.productTypes"
                      :key="option.productType"
                      class="flex min-h-10 cursor-pointer items-center gap-3 text-sm"
                    >
                      <input
                        type="radio"
                        name="type"
                        :value="option.productType"
                        :checked="first('type') === option.productType"
                        class="h-4 w-4 accent-primary"
                      />
                      {{ PRODUCT_TYPE_LABELS[option.productType] }}
                      <span class="ml-auto tabular-nums text-muted-foreground">{{ option.count }}</span>
                    </label>
                  </div>
                </fieldset>

                <fieldset v-for="facet in data.facets.attributes" :key="facet.key" class="pb-5">
                  <legend class="float-left mb-3 w-full pt-5 text-sm font-semibold">{{ facet.label }}</legend>
                  <div class="clear-both space-y-1">
                    <label
                      v-for="option in facet.values"
                      :key="option.value"
                      class="flex min-h-10 cursor-pointer items-center gap-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        :name="ATTRIBUTE_FILTER_PREFIX + facet.key"
                        :value="option.value"
                        :checked="isSelected(facet, option.value)"
                        class="h-4 w-4 accent-primary"
                      />
                      {{ valueLabel(facet, option.value) }}
                      <span class="ml-auto tabular-nums text-muted-foreground">{{ option.count }}</span>
                    </label>
                    <!-- Giá trị đang chọn mà không còn sản phẩm vẫn hiện, để bỏ chọn được. -->
                    <template v-for="value in values(ATTRIBUTE_FILTER_PREFIX + facet.key)" :key="`chon-${value}`">
                      <label
                        v-if="!facet.values.some((option) => option.value === value)"
                        class="flex min-h-10 cursor-pointer items-center gap-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          :name="ATTRIBUTE_FILTER_PREFIX + facet.key"
                          :value="value"
                          checked
                          class="h-4 w-4 accent-primary"
                        />
                        {{ valueLabel(facet, value) }}
                        <span class="ml-auto tabular-nums text-muted-foreground">0</span>
                      </label>
                    </template>
                  </div>
                </fieldset>

                <fieldset class="pb-5">
                  <legend class="float-left mb-3 w-full pt-5 text-sm font-semibold">Khoảng giá (₫)</legend>
                  <div class="clear-both flex items-center gap-2">
                    <input
                      type="number"
                      name="minPrice"
                      min="0"
                      step="1000"
                      inputmode="numeric"
                      aria-label="Giá từ"
                      :placeholder="data.facets.price ? String(data.facets.price.min) : 'Từ'"
                      :value="first('minPrice')"
                      class="field-input min-w-0"
                    />
                    <span class="text-muted-foreground" aria-hidden="true">–</span>
                    <input
                      type="number"
                      name="maxPrice"
                      min="0"
                      step="1000"
                      inputmode="numeric"
                      aria-label="Giá đến"
                      :placeholder="data.facets.price ? String(data.facets.price.max) : 'Đến'"
                      :value="first('maxPrice')"
                      class="field-input min-w-0"
                    />
                  </div>
                </fieldset>
              </div>

              <footer class="flex items-center gap-3 border-t border-border px-5 py-4">
                <NuxtLink :to="clearLink" class="btn-outline flex-1" @click="open = false">Xóa bộ lọc</NuxtLink>
                <button type="submit" class="btn-primary flex-1">Xem kết quả</button>
              </footer>
            </form>
          </details>
        </div>
      </div>

      <ProductCardGrid :list="data" :empty="empty" />
    </template>
  </section>
</template>
