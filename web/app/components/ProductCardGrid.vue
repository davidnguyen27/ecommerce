<script setup lang="ts">
import type { ProductCardList } from '@ecommerce/shared'

const props = defineProps<{ list: ProductCardList; empty: string }>()

const route = useRoute()
const lastPage = computed(() => Math.max(1, Math.ceil(props.list.total / props.list.pageSize)))
const pageLink = (page: number) => ({ query: { ...route.query, trang: page > 1 ? page : undefined } })
</script>

<template>
  <section>
    <p v-if="!list.items.length">{{ empty }}</p>
    <ul v-else class="grid">
      <li v-for="product in list.items" :key="product.slug">
        <NuxtLink :to="`/san-pham/${product.slug}`">
          <img
            v-if="product.image"
            :src="imageSrc(product.image, 320)"
            :srcset="srcset(product.image)"
            sizes="(min-width: 768px) 25vw, 50vw"
            :alt="product.image.alt || product.name"
            :width="product.image.width"
            :height="product.image.height"
            loading="lazy"
          />
          <span class="brand">{{ product.brand.name }}</span>
          <span class="name">{{ product.name }}</span>
          <span class="price">từ {{ formatVnd(product.fromPrice) }}</span>
          <span v-if="product.compareAtPrice" class="compare">
            Giá hãng <s>{{ formatVnd(product.compareAtPrice) }}</s>
          </span>
        </NuxtLink>
      </li>
    </ul>
    <nav v-if="lastPage > 1" aria-label="Trang">
      <NuxtLink v-if="list.page > 1" :to="pageLink(list.page - 1)">← Trang trước</NuxtLink>
      <span>Trang {{ list.page }}/{{ lastPage }}</span>
      <NuxtLink v-if="list.page < lastPage" :to="pageLink(list.page + 1)">Trang sau →</NuxtLink>
    </nav>
  </section>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
  padding: 0;
  list-style: none;
}
.grid a {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: inherit;
  text-decoration: none;
}
.grid img {
  width: 100%;
  height: auto;
  aspect-ratio: 1;
  object-fit: cover;
}
.brand,
.compare {
  font-size: 0.85em;
  opacity: 0.75;
}
.price {
  font-weight: 600;
}
</style>
