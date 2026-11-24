/** Blocks admin pages and the API; the search page stays crawlable so engines see its `noindex` and follow links. */
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
