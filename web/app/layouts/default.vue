<script setup lang="ts">
import { LegalInfo, PublishedPageList } from '@ecommerce/shared'

const { apiBase } = useRuntimeConfig()

// Chân trang có trên mọi trang khách; lỗi API thì chỉ thiếu chân trang, trang vẫn hiện.
const { data } = await useAsyncData('site-footer', async () => {
  const [legal, pages] = await Promise.all([
    $fetch('/api/legal-info', { baseURL: apiBase }),
    $fetch('/api/pages', { baseURL: apiBase }),
  ])
  return { legal: LegalInfo.parse(legal), pages: PublishedPageList.parse(pages).items }
})

const issuedOn = computed(() => {
  const date = data.value?.legal.businessRegistrationIssuedOn
  return date ? date.split('-').reverse().join('/') : ''
})
</script>

<template>
  <div>
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
