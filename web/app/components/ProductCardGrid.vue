<script setup lang="ts">
import type { ProductCardList } from '@ecommerce/shared'
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-vue-next'

const props = defineProps<{ list: ProductCardList; empty: string }>()

const route = useRoute()
const lastPage = computed(() => Math.max(1, Math.ceil(props.list.total / props.list.pageSize)))
const pageLink = (page: number) => ({ query: { ...route.query, trang: page > 1 ? page : undefined } })
</script>

<template>
  <section>
    <p
      v-if="!list.items.length"
      class="rounded-lg border border-dashed border-border bg-card px-6 py-16 text-center text-muted-foreground"
    >
      {{ empty }}
    </p>
    <ul v-else class="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-4">
      <li v-for="product in list.items" :key="product.slug">
        <NuxtLink :to="`/san-pham/${product.slug}`" class="group flex flex-col gap-1">
          <div class="relative mb-2 aspect-[4/5] overflow-hidden rounded-md bg-secondary">
            <span
              v-if="!product.inStock"
              class="absolute left-2 top-2 z-10 rounded bg-background/90 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
            >
              Hết hàng
            </span>
            <img
              v-if="product.image"
              :src="imageSrc(product.image, 320)"
              :srcset="srcset(product.image)"
              sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"
              :alt="product.image.alt || product.name"
              :width="product.image.width"
              :height="product.image.height"
              loading="lazy"
              class="h-full w-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.03]"
            />
            <div v-else class="flex h-full items-center justify-center text-muted-foreground">
              <ImageOff class="h-8 w-8" aria-hidden="true" />
            </div>
          </div>
          <span class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{{
            product.brand.name
          }}</span>
          <span class="line-clamp-2 text-sm font-medium leading-snug underline-offset-4 group-hover:underline">{{
            product.name
          }}</span>
          <span class="mt-0.5 text-sm font-semibold tabular-nums">từ {{ formatVnd(product.fromPrice) }}</span>
          <span v-if="product.compareAtPrice" class="text-xs text-muted-foreground">
            Giá hãng <s class="tabular-nums">{{ formatVnd(product.compareAtPrice) }}</s>
          </span>
        </NuxtLink>
      </li>
    </ul>
    <nav v-if="lastPage > 1" aria-label="Trang" class="mt-12 flex items-center justify-center gap-3 text-sm">
      <NuxtLink v-if="list.page > 1" :to="pageLink(list.page - 1)" class="btn-outline h-10 px-4">
        <ChevronLeft class="h-4 w-4" aria-hidden="true" /> Trang trước
      </NuxtLink>
      <span class="px-2 tabular-nums text-muted-foreground">Trang {{ list.page }}/{{ lastPage }}</span>
      <NuxtLink v-if="list.page < lastPage" :to="pageLink(list.page + 1)" class="btn-outline h-10 px-4">
        Trang sau <ChevronRight class="h-4 w-4" aria-hidden="true" />
      </NuxtLink>
    </nav>
  </section>
</template>
