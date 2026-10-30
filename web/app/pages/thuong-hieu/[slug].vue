<script setup lang="ts">
import { PublicBrand } from '@ecommerce/shared'

const route = useRoute()
const { apiBase } = useRuntimeConfig()
const slug = computed(() => String(route.params.slug))

const { data, error } = await useAsyncData(`brand-${slug.value}`, async () => {
  const body = await $fetch(`/api/brands/${encodeURIComponent(slug.value)}`, { baseURL: apiBase })
  return PublicBrand.parse(body)
})

if (error.value) throwPageError(error.value, 'thương hiệu')

useSeo({
  title: () => data.value?.name ?? '',
  description: () =>
    data.value ? excerpt(data.value.description || `Sản phẩm của thương hiệu ${data.value.name}.`) : '',
  canonicalPath: () => listingCanonicalPath(`/thuong-hieu/${slug.value}`, route.query),
  image: () => data.value?.logo?.originalUrl,
  noindex: () => isFilteredListing(route.query),
})
</script>

<template>
  <main v-if="data" class="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
    <nav aria-label="Đường dẫn" class="mb-6 text-sm text-muted-foreground">
      <NuxtLink to="/thuong-hieu" class="transition-colors hover:text-foreground">Thương hiệu</NuxtLink>
    </nav>
    <div class="mb-10 flex flex-col gap-6 sm:flex-row sm:items-center">
      <div
        v-if="data.logo"
        class="flex h-28 w-28 shrink-0 items-center justify-center rounded-lg border border-border bg-card p-4"
      >
        <img
          :src="imageSrc(data.logo, 160)"
          :srcset="srcset(data.logo)"
          sizes="160px"
          :alt="`Logo ${data.name}`"
          class="max-h-full w-auto object-contain"
        />
      </div>
      <div>
        <h1>{{ data.name }}</h1>
        <p v-if="data.description" class="mt-3 max-w-2xl whitespace-pre-line leading-relaxed text-muted-foreground">
          {{ data.description }}
        </p>
      </div>
    </div>
    <ProductSearch :brand="data.slug" empty="Chưa có sản phẩm của thương hiệu này." />
  </main>
</template>
