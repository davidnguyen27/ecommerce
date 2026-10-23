/** Chặn trang quản trị và API; trang tìm kiếm vẫn cho đọc để máy tìm kiếm thấy `noindex` và đi theo link. */
export default defineEventHandler((event) => {
  const { siteUrl } = useRuntimeConfig(event).public
  setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
  return [
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api',
    '',
    `Sitemap: ${new URL('/sitemap.xml', siteUrl).href}`,
    '',
  ].join('\n')
})
