<script setup lang="ts">
import { ProductSearchResult, PublicBrandList, type ProductType } from '@ecommerce/shared'
import {
  ArrowRight,
  FileCheck2,
  Footprints,
  Handbag,
  ScrollText,
  Shirt,
  ShieldCheck,
  Sparkles,
  Watch,
} from 'lucide-vue-next'

const { apiBase } = useRuntimeConfig()

// Một lần gọi danh sách sản phẩm cho cả hàng mới về lẫn số sản phẩm theo nhóm hàng (facets).
// Lỗi API thì chỉ thiếu phần đó, trang chủ vẫn hiện.
const { data: latest } = await useAsyncData('home-latest', async () => {
  const body = await $fetch('/api/products', { baseURL: apiBase, query: { sort: 'newest' } })
  return ProductSearchResult.parse(body)
})
const { data: brands } = await useAsyncData('home-brands', async () => {
  const body = await $fetch('/api/brands', { baseURL: apiBase })
  return PublicBrandList.parse(body).items
})

useSeo({ title: 'Trang chủ', description: 'Giày dép, quần áo, đồng hồ, túi xách và nước hoa.' })

const TYPE_ICONS: Record<ProductType, typeof Footprints> = {
  footwear: Footprints,
  apparel: Shirt,
  watch: Watch,
  bag: Handbag,
  fragrance: Sparkles,
}
const countOf = (type: ProductType) => latest.value?.facets.productTypes.find((t) => t.productType === type)?.count ?? 0
const types = Object.keys(PRODUCT_TYPE_LABELS) as ProductType[]

const products = computed(() => latest.value?.items.slice(0, 8) ?? [])
const heroImages = computed(() => products.value.filter((p) => p.image).slice(0, 3))
</script>

<template>
  <main>
    <section class="border-b border-border">
      <div class="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-2 lg:gap-16">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.18em] text-highlight">Hàng hiệu nhập khẩu chính hãng</p>
          <h1 class="mt-4 !text-4xl sm:!text-5xl lg:!text-6xl">Chọn đúng món đồ, biết rõ nguồn gốc</h1>
          <p class="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
            Giày dép, quần áo, đồng hồ, túi xách và nước hoa của các thương hiệu nổi tiếng. Mỗi sản phẩm ghi rõ thông
            tin nguồn gốc, giá và chính sách áp dụng trước khi bạn quyết định.
          </p>
          <div class="mt-8 flex flex-wrap gap-3">
            <NuxtLink to="/tim-kiem" class="btn-primary px-6">
              Xem tất cả sản phẩm <ArrowRight class="h-4 w-4" aria-hidden="true" />
            </NuxtLink>
            <NuxtLink to="/thuong-hieu" class="btn-outline px-6">Thương hiệu</NuxtLink>
          </div>
        </div>

        <div v-if="heroImages.length" class="grid grid-cols-2 gap-3" aria-hidden="true">
          <NuxtLink
            v-for="(product, index) in heroImages"
            :key="product.slug"
            :to="`/san-pham/${product.slug}`"
            tabindex="-1"
            class="relative overflow-hidden rounded-lg bg-secondary"
            :class="index === 0 && heroImages.length === 3 ? 'row-span-2' : 'aspect-[4/5]'"
          >
            <img
              :src="imageSrc(product.image!, 480)"
              :srcset="srcset(product.image!)"
              :sizes="index === 0 ? '(min-width: 1024px) 25vw, 50vw' : '(min-width: 1024px) 12vw, 25vw'"
              alt=""
              class="absolute inset-0 h-full w-full object-cover"
              :loading="index === 0 ? 'eager' : 'lazy'"
            />
          </NuxtLink>
        </div>
        <div
          v-else
          class="hidden aspect-[5/4] items-end rounded-lg bg-primary p-8 text-primary-foreground lg:flex"
          aria-hidden="true"
        >
          <p class="font-display text-3xl leading-tight">Giày dép · Quần áo · Đồng hồ · Túi xách · Nước hoa</p>
        </div>
      </div>
    </section>

    <section class="mx-auto max-w-7xl px-4 py-14 sm:px-6" aria-labelledby="nhom-hang">
      <h2 id="nhom-hang" class="!font-display !text-2xl sm:!text-3xl">Mua theo nhóm hàng</h2>
      <ul class="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <li v-for="type in types" :key="type">
          <NuxtLink
            :to="{ path: '/tim-kiem', query: { type } }"
            class="group flex h-full flex-col gap-6 rounded-lg border border-border bg-card p-5 transition-colors hover:border-foreground"
          >
            <component :is="TYPE_ICONS[type]" class="h-6 w-6 text-highlight" aria-hidden="true" />
            <span>
              <span class="block font-semibold">{{ PRODUCT_TYPE_LABELS[type] }}</span>
              <span v-if="countOf(type)" class="mt-0.5 block text-sm tabular-nums text-muted-foreground"
                >{{ countOf(type) }} sản phẩm</span
              >
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section v-if="products.length" class="mx-auto max-w-7xl px-4 py-14 sm:px-6" aria-labelledby="moi-ve">
      <div class="mb-8 flex items-end justify-between gap-4">
        <h2 id="moi-ve" class="!font-display !text-2xl sm:!text-3xl">Mới lên kệ</h2>
        <NuxtLink
          :to="{ path: '/tim-kiem', query: { sort: 'newest' } }"
          class="inline-flex items-center gap-1.5 text-sm font-medium hover:text-highlight"
        >
          Xem tất cả <ArrowRight class="h-4 w-4" aria-hidden="true" />
        </NuxtLink>
      </div>
      <ProductCardGrid :list="{ ...latest!, items: products, total: products.length }" empty="" />
    </section>

    <section class="border-y border-border bg-card">
      <ul class="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3">
        <li class="flex gap-4">
          <FileCheck2 class="h-6 w-6 shrink-0 text-highlight" aria-hidden="true" />
          <div>
            <h3 class="font-semibold">Cam kết có chứng từ</h3>
            <p class="mt-1.5 text-sm leading-6 text-muted-foreground">
              Bảo hành và các cam kết chỉ hiện trên trang sản phẩm khi doanh nghiệp có chứng từ nguồn hàng tương ứng.
            </p>
          </div>
        </li>
        <li class="flex gap-4">
          <ShieldCheck class="h-6 w-6 shrink-0 text-highlight" aria-hidden="true" />
          <div>
            <h3 class="font-semibold">Thông tin nguồn gốc rõ ràng</h3>
            <p class="mt-1.5 text-sm leading-6 text-muted-foreground">
              Xuất xứ, mã mẫu và SKU của từng biến thể được ghi trên trang sản phẩm để bạn đối chiếu.
            </p>
          </div>
        </li>
        <li class="flex gap-4">
          <ScrollText class="h-6 w-6 shrink-0 text-highlight" aria-hidden="true" />
          <div>
            <h3 class="font-semibold">Chính sách công khai</h3>
            <p class="mt-1.5 text-sm leading-6 text-muted-foreground">
              Chính sách đổi trả, bảo mật và các điều kiện mua hàng luôn có ở chân trang, kèm phiên bản và ngày cập
              nhật.
            </p>
          </div>
        </li>
      </ul>
    </section>

    <section v-if="brands?.length" class="mx-auto max-w-7xl px-4 py-14 sm:px-6" aria-labelledby="thuong-hieu">
      <div class="mb-8 flex items-end justify-between gap-4">
        <h2 id="thuong-hieu" class="!font-display !text-2xl sm:!text-3xl">Thương hiệu</h2>
        <NuxtLink to="/thuong-hieu" class="inline-flex items-center gap-1.5 text-sm font-medium hover:text-highlight">
          Tất cả thương hiệu <ArrowRight class="h-4 w-4" aria-hidden="true" />
        </NuxtLink>
      </div>
      <ul class="flex flex-wrap gap-2">
        <li v-for="brand in brands.slice(0, 16)" :key="brand.slug">
          <NuxtLink
            :to="`/thuong-hieu/${brand.slug}`"
            class="inline-flex h-11 items-center rounded-full border border-border bg-card px-5 font-display text-base font-semibold transition-colors hover:border-foreground"
            >{{ brand.name }}</NuxtLink
          >
        </li>
      </ul>
    </section>
  </main>
</template>
