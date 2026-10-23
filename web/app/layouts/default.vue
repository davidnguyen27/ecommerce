<script setup lang="ts">
import { CategoryTree, LegalInfo, PublishedPageList } from '@ecommerce/shared'

const { apiBase } = useRuntimeConfig()

// Chân trang có trên mọi trang khách; lỗi API thì chỉ thiếu chân trang, trang vẫn hiện.
const { data } = await useAsyncData('site-footer', async () => {
  const [legal, pages] = await Promise.all([
    $fetch('/api/legal-info', { baseURL: apiBase }),
    $fetch('/api/pages', { baseURL: apiBase }),
  ])
  return { legal: LegalInfo.parse(legal), pages: PublishedPageList.parse(pages).items }
})

// Menu tách khỏi chân trang để lỗi của bên này không làm mất bên kia.
const { data: menu } = await useAsyncData('site-menu', async () => {
  const tree = CategoryTree.parse(await $fetch('/api/categories', { baseURL: apiBase }))
  return tree.items.filter((root) => root.children.length)
})

const issuedOn = computed(() => {
  const date = data.value?.legal.businessRegistrationIssuedOn
  return date ? date.split('-').reverse().join('/') : ''
})
</script>

<template>
  <div>
    <header>
      <NuxtLink to="/">Trang chủ</NuxtLink>
      <!-- <details> mở được menu trên điện thoại mà không cần chờ JavaScript -->
      <details>
        <summary>Danh mục</summary>
        <nav aria-label="Danh mục">
          <section v-for="root in menu" :key="root.productType">
            <h2>{{ PRODUCT_TYPE_LABELS[root.productType] }}</h2>
            <CategoryMenu :categories="root.children" />
          </section>
          <NuxtLink to="/thuong-hieu">Thương hiệu</NuxtLink>
        </nav>
      </details>
    </header>
    <slot />
    <footer v-if="data">
      <nav v-if="data.pages.length">
        <NuxtLink v-for="page in data.pages" :key="page.slug" :to="`/trang/${page.slug}`">{{ page.title }}</NuxtLink>
      </nav>
      <address>
        <strong v-if="data.legal.companyName">{{ data.legal.companyName }}</strong>
        <p v-if="data.legal.businessRegistrationNumber">
          Mã số doanh nghiệp: {{ data.legal.businessRegistrationNumber }}
          <template v-if="issuedOn">, cấp ngày {{ issuedOn }}</template>
          <template v-if="data.legal.businessRegistrationIssuedBy">
            tại {{ data.legal.businessRegistrationIssuedBy }}</template
          >
        </p>
        <p v-if="data.legal.address">Địa chỉ: {{ data.legal.address }}</p>
        <p v-if="data.legal.phone">
          Điện thoại: <a :href="`tel:${data.legal.phone}`">{{ data.legal.phone }}</a>
        </p>
        <p v-if="data.legal.email">
          Email: <a :href="`mailto:${data.legal.email}`">{{ data.legal.email }}</a>
        </p>
      </address>
      <a v-if="data.legal.moitLogoUrl" :href="data.legal.moitNoticeUrl || undefined" target="_blank" rel="noopener">
        <img :src="data.legal.moitLogoUrl" alt="Đã thông báo Bộ Công Thương" width="150" />
      </a>
    </footer>
  </div>
</template>
