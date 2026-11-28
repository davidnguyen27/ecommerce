import { isDeepStrictEqual } from 'node:util'
import { Router } from 'express'
import { ChangeProductStatusRequest, ErrorCode, ProductPoliciesRequest, type ProductStatus } from '@ecommerce/shared'
import type { Storage } from '../core/adapters/storage.ts'
import { audited } from '../core/audit/audited.ts'
import { currentStaff, requirePermission } from '../core/middleware/staff-context.ts'
import { ProductParams, lockProduct } from '../catalog/products.ts'
import {
  buildSnapshot,
  createVersion,
  liveImages,
  liveSnapshot,
  loadDraft,
  publishBlockers,
  toAdminProductDetail,
  type Draft,
} from '../catalog/publication.ts'
import type { Db } from '../core/db.ts'
import type { Prisma } from '../generated/prisma/client.ts'
import { AppError, conflictField } from '../core/errors.ts'
import { parse } from '../core/middleware/validation.ts'
import { deleteImageFilesQuietly, type StoredImage } from '../core/media/images.ts'

const ACTIONS: Record<ProductStatus, string> = {
  published: 'catalog.product.publish',
  archived: 'catalog.product.archive',
  draft: 'catalog.product.unarchive',
}

/** Status and the version customers see, recorded in audit on transitions. */
const lifecycle = (draft: Draft) => ({ status: draft.status, liveVersion: draft.liveVersion?.version ?? null })

/**
 * Product lifecycle and policy pages, mounted at `/products/:id`; needs `catalog.edit`. Locks the product row like
 * variants and images, so concurrent edits cannot break publish conditions.
 */
export function adminProductPublishingRoutes(prisma: Db, storage: Storage) {
  return Router({ mergeParams: true })
    .put('/status', requirePermission('catalog.edit'), async (req, res) => {
      const { id } = parse(ProductParams, req.params)
      const { status } = parse(ChangeProductStatusRequest, req.body)
      const { draft, unused } = await audited(prisma, req, async (tx, audit) => {
        await lockProduct(tx, id)
        const before = await loadDraft(tx, id)
        const unchanged = { draft: before, unused: [] as StoredImage[] }
        if (before.status === status && status !== 'published') return unchanged
        if (before.status === 'published' && status === 'draft') {
          throw conflictField(
            'status',
            'Không đưa được sản phẩm đã xuất bản về nháp; muốn gỡ khỏi website thì lưu trữ sản phẩm',
          )
        }
        if (before.status === 'archived' && status === 'published') {
          throw conflictField('status', 'Sản phẩm lưu trữ phải được đưa về nháp trước khi xuất bản lại')
        }

        if (status === 'published') {
          const blockers = publishBlockers(before)
          if (blockers.length > 0) {
            throw new AppError(409, ErrorCode.CONFLICT, 'Sản phẩm chưa đủ điều kiện xuất bản', blockers)
          }
          const snapshot = buildSnapshot(before)
          // Republishing with no changes creates no duplicate version.
          if (isDeepStrictEqual(liveSnapshot(before), snapshot)) return unchanged
          await assertLiveSlugFree(tx, id, snapshot.slug)
          const version = await createVersion(tx, id, snapshot, currentStaff(req).id)
          await tx.product.update({ where: { id }, data: { status, liveVersionId: version.id } })
        } else {
          await tx.product.update({ where: { id }, data: { status, liveVersionId: null } })
        }

        const after = await loadDraft(tx, id)
        await audit({
          action: ACTIONS[status],
          entityType: 'product',
          entityId: id,
          before: lifecycle(before),
          after: lifecycle(after),
        })
        // Images removed from the draft kept their files for the old version; now that customers no longer see it,
        // delete them.
        const used = new Set([...after.images.map((i) => i.storageKey), ...liveImages(after).map((i) => i.key)])
        return { draft: after, unused: liveImages(before).filter((i) => !used.has(i.key)) }
      })
      for (const image of unused) await deleteImageFilesQuietly(storage, req, image)
      res.json(toAdminProductDetail(draft))
    })
    .put('/policies', requirePermission('catalog.edit'), async (req, res) => {
      const { id } = parse(ProductParams, req.params)
      const { pageIds } = parse(ProductPoliciesRequest, req.body)
      const wanted = [...new Set(pageIds)].sort()
      const draft = await audited(prisma, req, async (tx, audit) => {
        await lockProduct(tx, id)
        const before = await loadDraft(tx, id)
        const pages = await tx.contentPage.findMany({ where: { id: { in: wanted } } })
        pageIds.forEach((pageId, index) => {
          if (pages.find((p) => p.id === pageId)?.kind !== 'policy') {
            const message = 'Chỉ gắn được trang nội dung loại chính sách'
            throw new AppError(400, ErrorCode.VALIDATION_ERROR, message, [{ path: `pageIds.${index}`, message }])
          }
        })
        const current = before.policyPages.map((p) => p.pageId).sort()
        if (isDeepStrictEqual(current, wanted)) return before

        await tx.productPolicyPage.deleteMany({ where: { productId: id } })
        await tx.productPolicyPage.createMany({ data: wanted.map((pageId) => ({ productId: id, pageId })) })
        await audit({
          action: 'catalog.product.policies',
          entityType: 'product',
          entityId: id,
          before: { policyPageIds: current },
          after: { policyPageIds: wanted },
        })
        return loadDraft(tx, id)
      })
      res.json(toAdminProductDetail(draft))
    })
}

/**
 * Slugs are unique only among drafts: a product renamed but not republished keeps its old slug on the website. A
 * shared lock for every publish keeps two products from going live with one slug at the same time.
 */
async function assertLiveSlugFree(tx: Prisma.TransactionClient, productId: string, slug: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('catalog.product.live_slug'))`
  const taken = await tx.product.findFirst({ where: { id: { not: productId }, liveVersion: { slug } } })
  if (taken) throw conflictField('slug', 'Slug này đang được sản phẩm khác dùng trên website')
}
