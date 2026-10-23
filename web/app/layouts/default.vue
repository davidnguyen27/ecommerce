<script setup lang="ts">
import { ATTRIBUTE_FILTER_PREFIX, CategoryTree, GENDER_KEY, LegalInfo, PublishedPageList } from '@ecommerce/shared'

const { apiBase } = useRuntimeConfig()
const route = useRoute()

/** Lọc Nam hoặc Nữ thì API gồm cả sản phẩm Unisex. */
const GENDERS = ['Nam', 'Nữ'] as const
const genderQuery = (gender: string) => ({ [ATTRIBUTE_FILTER_PREFIX + GENDER_KEY]: gender })

function search(event: Event) {
  const q = String(new FormData(event.target as HTMLFormElement).get('q') ?? '').trim()
  return navigateTo({ path: '/tim-kiem', query: q ? { q } : {} })
}

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
      <!-- Server không biết khách đã đăng nhập chưa; trang tài khoản tự chuyển sang đăng nhập khi cần. -->
      <NuxtLink to="/tai-khoan">Tài khoản</NuxtLink>
      <!-- Form GET tìm được cả khi chưa có JavaScript; có JavaScript thì chuyển trang tại chỗ. -->
      <form action="/tim-kiem" method="get" role="search" @submit.prevent="search">
        <input
          type="search"
          name="q"
          :value="route.path === '/tim-kiem' ? route.query.q : ''"
          placeholder="Tên, thương hiệu, mã mẫu, SKU"
          aria-label="Tìm sản phẩm"
          enterkeyhint="search"
        />
        <button type="submit">Tìm</button>
      </form>
      <!-- Giới tính là bộ lọc, không phải nhánh danh mục (ADR 0004). -->
      <nav aria-label="Giới tính">
        <NuxtLink v-for="gender in GENDERS" :key="gender" :to="{ path: '/tim-kiem', query: genderQuery(gender) }">{{
          gender
        }}</NuxtLink>
      </nav>
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
