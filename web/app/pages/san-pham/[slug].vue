<script setup lang="ts">
import { PublicProduct, type AttributeValue } from '@ecommerce/shared'

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

useHead({ title: () => data.value?.name ?? '' })
</script>

<template>
  <main v-if="data" class="product">
    <nav v-if="data.category" aria-label="Đường dẫn">
      <span>{{ PRODUCT_TYPE_LABELS[data.productType] }}</span>
      › <NuxtLink :to="`/danh-muc/${data.category.slug}`">{{ data.category.name }}</NuxtLink>
    </nav>

    <section class="gallery" aria-label="Ảnh sản phẩm">
      <img
        v-for="(image, index) in images"
        :key="image.originalUrl"
        :src="imageSrc(image, 640)"
        :srcset="srcset(image)"
        sizes="(min-width: 768px) 50vw, 100vw"
        :alt="image.alt || data.name"
        :width="image.width"
        :height="image.height"
        :loading="index === 0 ? 'eager' : 'lazy'"
      />
    </section>

    <section class="buy">
      <p class="brand">
        <NuxtLink v-if="data.brand.slug" :to="`/thuong-hieu/${data.brand.slug}`">{{ data.brand.name }}</NuxtLink>
        <span v-else>{{ data.brand.name }}</span>
      </p>
      <h1>{{ data.name }}</h1>
      <p class="price" data-testid="price">{{ formatVnd(selected.price) }}</p>
      <p v-if="selected.compareAtPrice" class="compare">
        Giá hãng <s>{{ formatVnd(selected.compareAtPrice) }}</s>
      </p>
      <p class="codes">
        SKU: <span data-testid="sku">{{ selected.sku }}</span>
        <template v-if="data.modelCode"> · Mã mẫu: {{ data.modelCode }}</template>
      </p>

      <!-- Mỗi lựa chọn là một link tới `?sku=` của biến thể có thật, nên chọn được cả khi chưa có JavaScript. -->
      <fieldset v-for="choice in choices" :key="choice.definition.key" class="choice">
        <legend>{{ choice.definition.label }}</legend>
        <NuxtLink
          v-for="option in choice.options"
          :key="option.variant.sku + String(option.value)"
          :to="{ query: { sku: option.variant.sku } }"
          replace
          :aria-current="same(selected.attributes[choice.definition.key], option.value) ? 'true' : undefined"
        >
          {{ formatAttribute(choice.definition, option.value) }}
        </NuxtLink>
      </fieldset>
      <p v-if="data.groundShippingOnly"><small>Sản phẩm chỉ giao bằng đường bộ.</small></p>
    </section>

    <section v-if="data.description">
      <h2>Mô tả</h2>
      <p class="text">{{ data.description }}</p>
    </section>

    <section v-if="productAttributes.length">
      <h2>Thông số</h2>
      <dl>
        <template v-for="attribute in productAttributes" :key="attribute.label">
          <dt>{{ attribute.label }}</dt>
          <dd>{{ attribute.value }}</dd>
        </template>
        <template v-for="key in Object.keys(selected.attributes)" :key="key">
          <dt>{{ definitionOf(key)?.label ?? key }}</dt>
          <dd>{{ formatAttribute(definitionOf(key), selected.attributes[key]!) }}</dd>
        </template>
      </dl>
    </section>

    <section v-if="data.sizeChart">
      <h2>Bảng size</h2>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th v-for="(column, index) in data.sizeChart.columns" :key="index">{{ column }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in data.sizeChart.rows" :key="index">
              <td v-for="(cell, col) in row" :key="col">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="data.usageCare">
      <h2>Hướng dẫn sử dụng và bảo quản</h2>
      <p class="text">{{ data.usageCare }}</p>
    </section>

    <section v-if="data.originStatement">
      <h2>Thông tin nguồn gốc</h2>
      <p class="text">{{ data.originStatement }}</p>
      <p><small>Thông tin do doanh nghiệp công bố.</small></p>
    </section>

    <section v-if="data.policies.length">
      <h2>Chính sách áp dụng</h2>
      <ul>
        <li v-for="policy in data.policies" :key="policy.slug">
          <NuxtLink :to="`/trang/${policy.slug}`">{{ policy.title }}</NuxtLink>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.product {
  max-width: 1100px;
  margin: 0 auto;
}
.gallery {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
}
.gallery img {
  flex: 0 0 100%;
  width: 100%;
  height: auto;
  scroll-snap-align: start;
}
.price {
  font-size: 1.4em;
  font-weight: 700;
  margin: 0;
}
.compare,
.codes,
.brand {
  margin: 4px 0;
  opacity: 0.8;
}
.choice {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border: 0;
  padding: 0;
  margin: 12px 0;
}
.choice legend {
  margin-bottom: 4px;
}
.choice a {
  min-width: 44px;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid currentColor;
  border-radius: 4px;
  text-align: center;
  text-decoration: none;
  color: inherit;
}
.choice a[aria-current='true'] {
  outline: 2px solid currentColor;
  font-weight: 700;
}
.text {
  white-space: pre-line;
}
.scroll {
  overflow-x: auto;
}
</style>
