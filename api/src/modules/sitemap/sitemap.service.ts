import type { Sitemap } from '@ecommerce/shared'
import type { Db } from '../../core/db.ts'
import type { ICategoryQuery, VisibleCategory } from '../category/index.ts'
import { listPublishedPages } from '../content-page/index.ts'
import type { SitemapRepository } from './sitemap.repository.ts'

const flatten = (nodes: VisibleCategory[]): VisibleCategory[] =>
  nodes.flatMap((node) => [node, ...flatten(node.children)])

/**
 * What customers can open, for the website sitemap.xml. Read on each call, so it changes as soon as something is
 * published or archived. Hidden categories and brands are 404 and absent; products depend only on their own status
 * (GLOSSARY "Ẩn").
 */
export class SitemapService {
  constructor(
    private readonly prisma: Db,
    private readonly repo: SitemapRepository,
    private readonly categories: Pick<ICategoryQuery, 'loadVisibleTree'>,
  ) {}

  async build(): Promise<Sitemap> {
    const { prisma } = this
    const [products, tree, brands, pages] = await Promise.all([
      this.repo.liveProducts(prisma),
      this.categories.loadVisibleTree(prisma),
      this.repo.visibleBrands(prisma),
      listPublishedPages(prisma),
    ])
    const categories = tree.flatMap((root) => flatten(root.children))
    return {
      entries: [
        ...products.map((p) => ({ path: `/san-pham/${p.slug}`, lastModified: p.publishedAt.toISOString() })),
        ...categories.map((c) => ({ path: `/danh-muc/${c.slug}`, lastModified: c.updatedAt.toISOString() })),
        ...brands.map((b) => ({ path: `/thuong-hieu/${b.slug}`, lastModified: b.updatedAt.toISOString() })),
        ...pages.map((p) => ({ path: `/trang/${p.slug}`, lastModified: p.version.publishedAt.toISOString() })),
      ],
    }
  }
}
