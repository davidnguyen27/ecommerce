import { Router } from 'express'
import { z } from 'zod'
import {
  ErrorCode,
  type CategoryNode,
  type CategoryTree,
  type PublicBrand,
  type PublicBrandList,
  type PublicCategory,
} from '@ecommerce/shared'
import { findVisible, loadVisibleTree, type VisibleCategory } from '../catalog/categories.ts'
import type { Db } from '../db.ts'
import { AppError } from '../http/errors.ts'
import { parse } from '../http/validation.ts'

const SlugParams = z.object({ slug: z.string() })

function toNode(category: VisibleCategory): CategoryNode {
  return { slug: category.slug, name: category.name, children: category.children.map(toNode) }
}

/** Khách duyệt cây danh mục; danh mục bị ẩn hoặc nằm dưới danh mục bị ẩn coi như không có. */
export function publicCategoryRoutes(prisma: Db) {
  return Router()
    .get('/', async (_req, res) => {
      const tree = await loadVisibleTree(prisma)
      const body: CategoryTree = {
        items: tree.map((root) => ({ productType: root.productType, children: root.children.map(toNode) })),
      }
      res.json(body)
    })
    .get('/:slug', async (req, res) => {
      const { slug } = parse(SlugParams, req.params)
      const found = findVisible(await loadVisibleTree(prisma), slug)
      if (!found) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy danh mục')
      const { category, ancestors } = found
      const body: PublicCategory = {
        slug: category.slug,
        name: category.name,
        productType: category.productType,
        ancestors,
        children: category.children.map(({ slug, name }) => ({ slug, name })),
      }
      res.json(body)
    })
}

/** Khách duyệt thương hiệu; thương hiệu bị ẩn coi như không có. */
export function publicBrandRoutes(prisma: Db) {
  return Router()
    .get('/', async (_req, res) => {
      const brands = await prisma.brand.findMany({
        where: { hidden: false },
        select: { slug: true, name: true },
        orderBy: { name: 'asc' },
      })
      const body: PublicBrandList = { items: brands }
      res.json(body)
    })
    .get('/:slug', async (req, res) => {
      const { slug } = parse(SlugParams, req.params)
      const brand = await prisma.brand.findFirst({
        where: { slug, hidden: false },
        select: { slug: true, name: true, description: true },
      })
      if (!brand) throw new AppError(404, ErrorCode.NOT_FOUND, 'Không tìm thấy thương hiệu')
      const body: PublicBrand = brand
      res.json(body)
    })
}
