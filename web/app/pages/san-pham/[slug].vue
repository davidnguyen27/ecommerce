<script setup lang="ts">
import { PublicProduct, type AttributeValue } from '@ecommerce/shared'
import { ChevronRight, FileCheck2, Truck } from 'lucide-vue-next'

const route = useRoute()
const { apiBase } = useRuntimeConfig()
const slug = computed(() => String(route.params.slug))

// Khóa theo slug: đổi biến thể chỉ đổi `?sku=`, không tải lại sản phẩm.
const { data, error } = await useAsyncData(`product-${slug.value}`, async () => {
  const body = await $fetch(`/api/products/${encodeURIComponent(slug.value)}`, { baseURL: apiBase })
  return PublicProduct.parse(body)
})

if (error.value) {
  const notFound = (error.value as { statusCode?: number }).statusCode === 404
  throw createError({
    statusCode: notFound ? 404 : 502,
    message: notFound ? 'Không tìm thấy sản phẩm' : 'Không tải được sản phẩm',
    fatal: true,
  })
}

type Variant = PublicProduct['variants'][number]

const definitionOf = (key: string) => data.value?.attributeSchema.find((d) => d.key === key)
const same = (a: AttributeValue | undefined, b: AttributeValue | undefined) => JSON.stringify(a) === JSON.stringify(b)

/** Biến thể theo `?sku=`; không có hoặc sai thì biến thể đầu tiên. */
const selected = computed<Variant>(() => {
  const variants = data.value!.variants
  return variants.find((v) => v.sku === route.query.sku) ?? variants[0]!
})

/** Thuộc tính cấp biến thể theo thứ tự schema, mỗi thuộc tính kèm các giá trị có ở ít nhất một biến thể. */
const choices = computed(() =>
  data
    .value!.attributeSchema.filter((d) => d.level === 'variant')
    .map((definition) => {
      const values: AttributeValue[] = []
      for (const variant of data.value!.variants) {
        const value = variant.attributes[definition.key]
        if (value !== undefined && !values.some((v) => same(v, value))) values.push(value)
      }
      return { definition, options: values.map((value) => ({ value, variant: closest(definition.key, value) })) }
    })
    .filter((choice) => choice.options.length > 1),
)

/**
 * Biến thể có thật mang giá trị này, giữ được nhiều lựa chọn hiện tại nhất; nhờ vậy mọi lựa chọn đều dẫn tới
 * một tổ hợp có thật, kể cả khi tổ hợp với lựa chọn hiện tại không có.
 */
function closest(key: string, value: AttributeValue): Variant {
  const current = selected.value.attributes
  const score = (v: Variant) =>
    Object.keys(current).filter((k) => k !== key && same(v.attributes[k], current[k])).length
  return data
    .value!.variants.filter((v) => same(v.attributes[key], value))
    .reduce((best, v) => (score(v) > score(best) ? v : best))
}

/** Ảnh của biến thể đang chọn trước, rồi tới ảnh chung. */
const images = computed(() => {
  const all = data.value!.images
  const own = all.filter((image) => image.skus.includes(selected.value.sku))
  return [...own, ...all.filter((image) => image.skus.length === 0)]
})

const productAttributes = computed(() =>
  data
    .value!.attributeSchema.filter((d) => d.level === 'product' && data.value!.attributes[d.key] !== undefined)
    .map((d) => ({ label: d.label, value: formatAttribute(d, data.value!.attributes[d.key]!) })),
)

// API nhận cả slug cũ (đã đổi rồi xuất bản lại) và trả slug hiện tại: chuyển hướng hẳn để link cũ không mất.
if (data.value && data.value.slug !== slug.value) {
  await navigateTo({ path: `/san-pham/${data.value.slug}`, query: route.query }, { redirectCode: 301 })
}

// Mọi biến thể (`?sku=`) dùng chung một canonical là trang sản phẩm.
const canonicalPath = computed(() => `/san-pham/${data.value?.slug ?? slug.value}`)
const absolute = useAbsoluteUrl()
useSeo({
  title: () => data.value?.name ?? '',
  description: () => {
    const product = data.value
    if (!product) return ''
    if (product.description) return excerpt(product.description)
    const from = Math.min(...product.variants.map((v) => v.price))
    return `${product.name} của ${product.brand.name}, giá từ ${formatVnd(from)}.`
  },
  canonicalPath,
  image: () => data.value?.images[0]?.originalUrl,
})
useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: () =>
        data.value ? jsonLdScript(productJsonLd(data.value, absolute(canonicalPath.value), absolute)) : '',
    },
  ],
})
</script>

<template>
  <main v-if="data" class="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
    <nav
      v-if="data.category"
      aria-label="Đường dẫn"
      class="mb-6 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground"
    >
      <span>{{ PRODUCT_TYPE_LABELS[data.productType] }}</span>
      <ChevronRight class="h-3.5 w-3.5" aria-hidden="true" />
      <NuxtLink :to="`/danh-muc/${data.category.slug}`" class="transition-colors hover:text-foreground">{{
        data.category.name
      }}</NuxtLink>
    </nav>

    <div class="grid gap-8 lg:grid-cols-12 lg:gap-12">
      <!-- Điện thoại: vuốt ngang từng ảnh; máy tính: xếp lưới, ảnh đầu to. -->
      <section
        class="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0 lg:col-span-7 lg:grid lg:grid-cols-2 lg:gap-3 lg:overflow-visible"
        aria-label="Ảnh sản phẩm"
      >
        <img
          v-for="(image, index) in images"
          :key="image.originalUrl"
          :src="imageSrc(image, 640)"
          :srcset="srcset(image)"
          :sizes="index === 0 ? '(min-width: 1024px) 58vw, 100vw' : '(min-width: 1024px) 29vw, 100vw'"
          :alt="image.alt || data.name"
          :width="image.width"
          :height="image.height"
          :loading="index === 0 ? 'eager' : 'lazy'"
          class="aspect-[4/5] w-full flex-none snap-start rounded-md bg-secondary object-cover"
          :class="{ 'lg:col-span-2': index === 0 }"
        />
      </section>

      <section class="lg:col-span-5">
        <div class="lg:sticky lg:top-28">
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <NuxtLink
              v-if="data.brand.slug"
              :to="`/thuong-hieu/${data.brand.slug}`"
              class="transition-colors hover:text-foreground"
              >{{ data.brand.name }}</NuxtLink
            >
            <span v-else>{{ data.brand.name }}</span>
          </p>
          <h1 class="mt-2">{{ data.name }}</h1>

          <div class="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p class="text-2xl font-semibold tabular-nums" data-testid="price">{{ formatVnd(selected.price) }}</p>
            <p v-if="selected.compareAtPrice" class="text-sm text-muted-foreground">
              Giá hãng <s class="tabular-nums">{{ formatVnd(selected.compareAtPrice) }}</s>
            </p>
          </div>
          <p class="mt-2 text-xs text-muted-foreground">
            SKU: <span data-testid="sku" class="tabular-nums text-foreground">{{ selected.sku }}</span>
            <template v-if="data.modelCode"> · Mã mẫu: {{ data.modelCode }}</template>
          </p>

          <!-- Mỗi lựa chọn là một link tới `?sku=` của biến thể có thật, nên chọn được cả khi chưa có JavaScript. -->
          <fieldset v-for="choice in choices" :key="choice.definition.key" class="mt-6 border-t border-border pt-5">
            <legend class="float-left mb-3 w-full text-sm">
              <span class="font-semibold">{{ choice.definition.label }}</span>
              <span v-if="selected.attributes[choice.definition.key] !== undefined" class="text-muted-foreground">
                · {{ formatAttribute(choice.definition, selected.attributes[choice.definition.key]!) }}</span
              >
            </legend>
            <div class="clear-both flex flex-wrap gap-2">
              <NuxtLink
                v-for="option in choice.options"
                :key="option.variant.sku + String(option.value)"
                :to="{ query: { sku: option.variant.sku } }"
                replace
                :aria-current="same(selected.attributes[choice.definition.key], option.value) ? 'true' : undefined"
                class="inline-flex h-11 min-w-11 items-center justify-center rounded-md border border-border bg-card px-4 text-sm transition-colors hover:border-foreground aria-[current]:border-foreground aria-[current]:bg-primary aria-[current]:font-semibold aria-[current]:text-primary-foreground"
              >
                {{ formatAttribute(choice.definition, option.value) }}
              </NuxtLink>
            </div>
          </fieldset>

          <ul
            v-if="data.commitments.length || data.groundShippingOnly"
            class="mt-6 space-y-3 border-t border-border pt-5 text-sm text-muted-foreground"
          >
            <li v-if="data.commitments.length" class="flex gap-3">
              <FileCheck2 class="h-5 w-5 shrink-0 text-highlight" aria-hidden="true" />
              <a href="#evidenced-heading" class="hover:text-foreground"
                >{{ data.commitments.length }} cam kết dựa trên chứng từ nguồn hàng</a
              >
            </li>
            <li v-if="data.groundShippingOnly" class="flex gap-3">
              <Truck class="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>Sản phẩm chỉ giao bằng đường bộ.</span>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <div class="mt-16 grid gap-12 border-t border-border pt-12 lg:grid-cols-12">
      <div class="space-y-12 lg:col-span-7">
        <section v-if="data.description">
          <h2>Mô tả</h2>
          <p class="mt-4 whitespace-pre-line leading-7 text-foreground/90">{{ data.description }}</p>
        </section>

        <section v-if="productAttributes.length || Object.keys(selected.attributes).length">
          <h2>Thông số</h2>
          <dl class="mt-4 divide-y divide-border border-y border-border text-sm">
            <div v-for="attribute in productAttributes" :key="attribute.label" class="grid grid-cols-3 gap-4 py-3">
              <dt class="text-muted-foreground">{{ attribute.label }}</dt>
              <dd class="col-span-2">{{ attribute.value }}</dd>
            </div>
            <div v-for="key in Object.keys(selected.attributes)" :key="key" class="grid grid-cols-3 gap-4 py-3">
              <dt class="text-muted-foreground">{{ definitionOf(key)?.label ?? key }}</dt>
              <dd class="col-span-2">{{ formatAttribute(definitionOf(key), selected.attributes[key]!) }}</dd>
            </div>
          </dl>
        </section>

        <section v-if="data.sizeChart">
          <h2>Bảng size</h2>
          <div class="mt-4 overflow-x-auto rounded-md border border-border">
            <table class="w-full text-sm tabular-nums">
              <thead class="bg-secondary">
                <tr>
                  <th
                    v-for="(column, index) in data.sizeChart.columns"
                    :key="index"
                    class="whitespace-nowrap px-3 py-2.5 text-left font-semibold"
                  >
                    {{ column }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                <tr v-for="(row, index) in data.sizeChart.rows" :key="index">
                  <td v-for="(cell, col) in row" :key="col" class="whitespace-nowrap px-3 py-2.5">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section v-if="data.usageCare">
          <h2>Hướng dẫn sử dụng và bảo quản</h2>
          <p class="mt-4 whitespace-pre-line leading-7 text-foreground/90">{{ data.usageCare }}</p>
        </section>
      </div>

      <aside class="space-y-6 lg:col-span-5">
        <section v-if="data.originStatement" class="rounded-lg border border-border bg-card p-6">
          <h2>Thông tin nguồn gốc</h2>
          <p class="mt-3 whitespace-pre-line text-sm leading-6">{{ data.originStatement }}</p>
          <p class="mt-3 text-xs text-muted-foreground">Thông tin do doanh nghiệp công bố.</p>
        </section>

        <EvidencedCommitments :commitments="data.commitments" />

        <section v-if="data.policies.length" class="rounded-lg border border-border bg-card p-6">
          <h2>Chính sách áp dụng</h2>
          <ul class="mt-3 divide-y divide-border text-sm">
            <li v-for="policy in data.policies" :key="policy.slug">
              <NuxtLink
                :to="`/trang/${policy.slug}`"
                class="flex min-h-11 items-center justify-between py-3 transition-colors hover:text-highlight"
              >
                {{ policy.title }}
                <ChevronRight class="h-4 w-4" aria-hidden="true" />
              </NuxtLink>
            </li>
          </ul>
        </section>
      </aside>
    </div>
  </main>
</template>
