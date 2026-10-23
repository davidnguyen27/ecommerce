// Cache ngắn ở server Nuxt cho trang khách đọc nhiều; xuất bản hoặc lưu trữ hiện ra chậm nhất sau chừng này giây.
// Khóa cache gồm cả query (`?sku=`, bộ lọc); trang lỗi không được cache.
const SHORT_CACHE = { swr: 60 }

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
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
