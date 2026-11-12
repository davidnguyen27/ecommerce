<script setup lang="ts">
import { ATTRIBUTE_FILTER_PREFIX, CategoryTree, GENDER_KEY, LegalInfo, PublishedPageList } from '@ecommerce/shared'
import { Search, ShoppingBag, UserRound, X } from 'lucide-vue-next'

const { apiBase } = useRuntimeConfig()
const route = useRoute()
const cart = useCart()

/** Lọc Nam hoặc Nữ thì API gồm cả sản phẩm Unisex. */
const GENDERS = ['Nam', 'Nữ'] as const
const genderQuery = (gender: string) => ({ [ATTRIBUTE_FILTER_PREFIX + GENDER_KEY]: gender })
const activeGender = computed(() => route.path === '/tim-kiem' && route.query[ATTRIBUTE_FILTER_PREFIX + GENDER_KEY])

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
  return date ? formatDateOnly(date) : ''
})

// Menu là <details> để mở được khi chưa có JavaScript; có JavaScript thì tự đóng khi chuyển trang, bấm ra ngoài hoặc Esc.
const menuEl = ref<HTMLDetailsElement>()
const closeMenu = () => menuEl.value?.removeAttribute('open')
watch(() => route.fullPath, closeMenu)
function onDocumentClick(event: MouseEvent) {
  if (menuEl.value?.open && !menuEl.value.contains(event.target as Node)) closeMenu()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && menuEl.value?.open) {
    closeMenu()
    menuEl.value.querySelector('summary')?.focus()
  }
}
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="storefront flex min-h-screen flex-col">
    <a
      href="#noi-dung"
      class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >Bỏ qua tới nội dung</a
    >

    <!-- Không dùng backdrop-filter ở đây: nó biến header thành khung chứa của ngăn kéo `fixed` bên trong. -->
    <header class="sticky top-0 z-40 border-b border-border bg-background">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-3 px-4 py-3 sm:px-6 lg:gap-x-4">
        <!-- <details> mở được menu trên điện thoại mà không cần chờ JavaScript -->
        <details ref="menuEl" class="site-menu relative -ml-2 lg:order-2 lg:ml-0">
          <summary>Danh mục</summary>
          <div
            class="fixed inset-y-0 left-0 z-50 w-[min(360px,88vw)] overflow-y-auto bg-card p-5 shadow-[0_0_0_100vmax_rgb(0_0_0/0.45)] lg:absolute lg:inset-auto lg:left-0 lg:top-full lg:mt-2 lg:w-[min(960px,calc(100vw-3rem))] lg:rounded-lg lg:border lg:border-border lg:p-6 lg:shadow-xl"
          >
            <div class="mb-4 flex items-center justify-between lg:hidden">
              <span class="font-display text-lg font-semibold">Danh mục</span>
              <button
                type="button"
                class="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-secondary"
                aria-label="Đóng menu"
                @click="closeMenu"
              >
                <X class="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Danh mục" class="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
              <section v-for="root in menu" :key="root.productType">
                <h2 class="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {{ PRODUCT_TYPE_LABELS[root.productType] }}
                </h2>
                <CategoryMenu :categories="root.children" />
              </section>
            </nav>
            <div class="mt-6 flex flex-wrap gap-2 border-t border-border pt-5 text-sm lg:hidden">
              <NuxtLink
                v-for="gender in GENDERS"
                :key="gender"
                :to="{ path: '/tim-kiem', query: genderQuery(gender) }"
                class="btn-outline h-10"
                >{{ gender }}</NuxtLink
              >
              <NuxtLink to="/thuong-hieu" class="btn-outline h-10">Thương hiệu</NuxtLink>
            </div>
          </div>
        </details>

        <NuxtLink
          to="/"
          class="mr-auto flex items-center gap-2.5 lg:order-1 lg:mr-2"
          aria-label="Atelier, về trang chủ"
        >
          <span
            class="flex h-9 w-9 items-center justify-center rounded-md bg-primary font-display text-lg font-semibold text-primary-foreground"
            aria-hidden="true"
            >A</span
          >
          <span class="leading-none">
            <span class="block font-display text-lg font-semibold tracking-wide">Atelier</span>
            <span class="mt-0.5 hidden text-[11px] tracking-[0.12em] text-muted-foreground sm:block"
              >HÀNG HIỆU NHẬP KHẨU</span
            >
          </span>
        </NuxtLink>

        <!-- Giới tính là bộ lọc, không phải nhánh danh mục (ADR 0004). -->
        <nav aria-label="Giới tính" class="hidden items-center gap-1 text-sm font-medium lg:order-3 lg:flex">
          <NuxtLink
            v-for="gender in GENDERS"
            :key="gender"
            :to="{ path: '/tim-kiem', query: genderQuery(gender) }"
            class="inline-flex h-10 items-center rounded-md px-3 transition-colors hover:bg-secondary"
            :class="{ 'bg-secondary': activeGender === gender }"
            >{{ gender }}</NuxtLink
          >
          <NuxtLink
            to="/thuong-hieu"
            class="inline-flex h-10 items-center rounded-md px-3 transition-colors hover:bg-secondary"
            active-class="bg-secondary"
            >Thương hiệu</NuxtLink
          >
        </nav>

        <!-- Form GET tìm được cả khi chưa có JavaScript; có JavaScript thì chuyển trang tại chỗ. -->
        <form
          action="/tim-kiem"
          method="get"
          role="search"
          class="relative order-last w-full md:order-4 md:ml-auto md:w-72 lg:w-80"
          @submit.prevent="search"
        >
          <Search
            class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            name="q"
            :value="route.path === '/tim-kiem' ? route.query.q : ''"
            placeholder="Tên, thương hiệu, mã mẫu, SKU"
            aria-label="Tìm sản phẩm"
            enterkeyhint="search"
            class="h-10 w-full rounded-md border border-input bg-secondary pl-9 pr-3 text-base transition-colors placeholder:text-muted-foreground focus:bg-card focus-visible:border-foreground md:text-sm"
          />
        </form>

        <!-- Server không biết khách đã đăng nhập chưa; trang tài khoản tự chuyển sang đăng nhập khi cần. -->
        <NuxtLink
          to="/tai-khoan"
          class="inline-flex h-10 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors hover:bg-secondary lg:order-5"
        >
          <UserRound class="h-5 w-5" aria-hidden="true" />
          <span class="hidden sm:inline">Tài khoản</span>
          <span class="sr-only sm:hidden">Tài khoản</span>
        </NuxtLink>

        <!-- Số món chỉ có sau khi mount (giỏ ở localStorage), nên HTML từ server không lệch với lúc hydrate. -->
        <NuxtLink
          to="/gio-hang"
          class="relative inline-flex h-10 items-center gap-2 rounded-md px-2.5 text-sm font-medium transition-colors hover:bg-secondary lg:order-6"
          data-testid="cart-link"
          :aria-label="cart.count.value ? `Giỏ hàng, ${cart.count.value} món` : 'Giỏ hàng'"
        >
          <ShoppingBag class="h-5 w-5" aria-hidden="true" />
          <span class="hidden sm:inline">Giỏ hàng</span>
          <!-- Tên truy cập ở aria-label: ghép từ các span trong flex thì trình duyệt chèn dấu cách trước dấu phẩy. -->
          <span
            v-if="cart.count.value"
            class="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums text-primary-foreground sm:static sm:h-5"
            data-testid="cart-count"
            >{{ cart.count.value }}</span
          >
        </NuxtLink>
      </div>
    </header>

    <div id="noi-dung" class="flex-1">
      <slot />
    </div>

    <footer v-if="data" class="mt-20 border-t border-border bg-card text-sm text-muted-foreground">
      <div class="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-12">
        <div class="md:col-span-4">
          <p class="font-display text-xl font-semibold text-foreground">Atelier</p>
          <p class="mt-3 max-w-xs leading-relaxed">Giày dép, quần áo, đồng hồ, túi xách và nước hoa.</p>
        </div>

        <nav v-if="data.pages.length" aria-label="Chính sách" class="md:col-span-3">
          <p class="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-foreground">Chính sách</p>
          <ul class="space-y-2.5">
            <li v-for="page in data.pages" :key="page.slug">
              <NuxtLink :to="`/trang/${page.slug}`" class="transition-colors hover:text-foreground">{{
                page.title
              }}</NuxtLink>
            </li>
          </ul>
        </nav>

        <div class="md:col-span-5">
          <p class="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-foreground">Thông tin doanh nghiệp</p>
          <address class="space-y-1.5 not-italic leading-relaxed">
            <strong v-if="data.legal.companyName" class="block font-semibold text-foreground">{{
              data.legal.companyName
            }}</strong>
            <p v-if="data.legal.businessRegistrationNumber">
              Mã số doanh nghiệp:
              <span class="tabular-nums text-foreground">{{ data.legal.businessRegistrationNumber }}</span>
              <template v-if="issuedOn">, cấp ngày {{ issuedOn }}</template>
              <template v-if="data.legal.businessRegistrationIssuedBy">
                tại {{ data.legal.businessRegistrationIssuedBy }}</template
              >
            </p>
            <p v-if="data.legal.address">Địa chỉ: {{ data.legal.address }}</p>
            <p v-if="data.legal.phone">
              Điện thoại: <a :href="`tel:${data.legal.phone}`" class="link">{{ data.legal.phone }}</a>
            </p>
            <p v-if="data.legal.email">
              Email: <a :href="`mailto:${data.legal.email}`" class="link">{{ data.legal.email }}</a>
            </p>
          </address>
          <a
            v-if="data.legal.moitLogoUrl"
            :href="data.legal.moitNoticeUrl || undefined"
            target="_blank"
            rel="noopener"
            class="mt-4 inline-block"
          >
            <img :src="data.legal.moitLogoUrl" alt="Đã thông báo Bộ Công Thương" class="h-12 w-auto" />
          </a>
        </div>
      </div>
      <div class="border-t border-border">
        <p class="mx-auto max-w-7xl px-4 py-5 text-xs sm:px-6">
          © {{ new Date().getFullYear() }} {{ data.legal.companyName || 'Atelier' }}
        </p>
      </div>
    </footer>
  </div>
</template>
