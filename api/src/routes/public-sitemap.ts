import { Router } from 'express'
import type { Sitemap } from '@ecommerce/shared'
import { loadVisibleTree, type VisibleCategory } from '../catalog/categories.ts'
import { listPublishedPages } from '../content/pages.ts'
import type { Db } from '../core/db.ts'

/**
 * What customers can open, for the website sitemap.xml. Read on each call, so it changes as soon as something is
 * published or archived. Hidden categories and brands are 404 and absent; products depend only on their own status
 * (GLOSSARY "Ẩn").
 */
export function publicSitemapRoutes(prisma: Db) {
  return Router().get('/', async (_req, res) => {
    const [products, tree, brands, pages] = await Promise.all([
      prisma.productVersion.findMany({
        where: { liveOf: { isNot: null } },
        select: { slug: true, publishedAt: true },
        orderBy: { publishedAt: 'desc' },
      }),
      loadVisibleTree(prisma),
      prisma.brand.findMany({
        where: { hidden: false },
        select: { slug: true, updatedAt: true },
        orderBy: { name: 'asc' },
      }),
      listPublishedPages(prisma),
    ])
    const flatten = (nodes: VisibleCategory[]): VisibleCategory[] =>
      nodes.flatMap((node) => [node, ...flatten(node.children)])
    const categories = tree.flatMap((root) => flatten(root.children))

    const body: Sitemap = {
      entries: [
        ...products.map((p) => ({ path: `/san-pham/${p.slug}`, lastModified: p.publishedAt.toISOString() })),
        ...categories.map((c) => ({ path: `/danh-muc/${c.slug}`, lastModified: c.updatedAt.toISOString() })),
        ...brands.map((b) => ({ path: `/thuong-hieu/${b.slug}`, lastModified: b.updatedAt.toISOString() })),
        ...pages.map((p) => ({ path: `/trang/${p.slug}`, lastModified: p.version.publishedAt.toISOString() })),
      ],
    }
    res.json(body)
  })
}
