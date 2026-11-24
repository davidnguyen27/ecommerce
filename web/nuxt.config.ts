// Short Nuxt server cache for heavily read customer pages; publishes or archives show within this many seconds.
// The cache key includes the query (`?sku=`, filters); error pages are not cached.
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
    // API address the Nuxt server calls during SSR (inside the Docker network).
    // Override with NUXT_API_BASE.
    apiBase: 'http://localhost:3001',
    public: {
      // Public website base URL, for canonical, Open Graph, sitemap. Override with NUXT_PUBLIC_SITE_URL.
      siteUrl: 'http://localhost',
    },
  },
  routeRules: {
    '/admin/**': { ssr: false, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } },
    '/san-pham/**': SHORT_CACHE,
    '/danh-muc/**': SHORT_CACHE,
  },
})
