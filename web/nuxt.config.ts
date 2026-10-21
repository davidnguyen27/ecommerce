export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  runtimeConfig: {
    // Địa chỉ API mà server Nuxt gọi khi render SSR (trong mạng nội bộ Docker).
    // Ghi đè bằng NUXT_API_BASE.
    apiBase: 'http://localhost:3001',
  },
  routeRules: {
    '/admin/**': { ssr: false },
  },
})
