// Cache ngắn ở server Nuxt cho trang khách đọc nhiều; xuất bản hoặc lưu trữ hiện ra chậm nhất sau chừng này giây.
// Khóa cache gồm cả query (`?sku=`, bộ lọc); trang lỗi không được cache.
const SHORT_CACHE = { swr: 60 }

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  modules: ['@nuxtjs/tailwindcss'],
  app: {
    head: {
      htmlAttrs: { lang: 'vi' },
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap',
        },
      ],
    },
  },
  tailwindcss: {
    cssPath: '~/assets/css/tailwind.css',
    configPath: 'tailwind.config.ts',
  },
  components: {
    dirs: [
      {
        path: '~/components',
        extensions: ['.vue'],
      },
    ],
  },
  runtimeConfig: {
    // Địa chỉ API mà server Nuxt gọi khi render SSR (trong mạng nội bộ Docker).
    // Ghi đè bằng NUXT_API_BASE.
    apiBase: 'http://localhost:3001',
    public: {
      // Gốc URL công khai của website, cho canonical, Open Graph, sitemap. Ghi đè bằng NUXT_PUBLIC_SITE_URL.
      siteUrl: 'http://localhost',
    },
  },
  routeRules: {
    '/admin/**': { ssr: false, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } },
    '/san-pham/**': SHORT_CACHE,
    '/danh-muc/**': SHORT_CACHE,
  },
})
