import { Sitemap } from '@ecommerce/shared'

const XML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const escapeXml = (text: string) => text.replace(/[&<>"']/g, (c) => XML_ENTITIES[c]!)

/**
 * The sitemap is built from the API on every read, so new publishes appear and archived or hidden content vanish at
 * once.
 */
export default defineEventHandler(async (event) => {
  const { apiBase, public: site } = useRuntimeConfig(event)
  const { entries } = Sitemap.parse(await $fetch('/api/sitemap', { baseURL: apiBase }))
  const pages: { path: string; lastModified?: string }[] = [{ path: '/' }, { path: '/thuong-hieu' }, ...entries]
  const urls = pages.map((page) => {
    const loc = `<loc>${escapeXml(new URL(page.path, site.siteUrl).href)}</loc>`
    return `<url>${loc}${page.lastModified ? `<lastmod>${page.lastModified}</lastmod>` : ''}</url>`
  })
  setResponseHeader(event, 'content-type', 'application/xml; charset=utf-8')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
  ].join('\n')
})
