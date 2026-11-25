# Fixes from the whole-branch code review (spec/m0-m1-nen-mong-danh-muc vs main)

Fix all of these in one branch `fix/review`. Each item: test first where it is behaviour (HTTP test), then fix. Record behaviour decisions in the relevant ticket's "Quyết định" section (append a dated bullet "Sau code review (2026-10-24): …"), not in a new ticket.

## Behaviour (spec + standards)

1. **Accountant price changes must reach customers without a re-publish.** Spec: "`price` … yêu cầu `price.edit`, tách khỏi `catalog.edit`"; "chỉ người có quyền sửa giá mới đổi được giá". Today an accountant (only `price.edit`) changes a price that stays invisible until someone with `catalog.edit` re-publishes (`admin-product-publishing.ts:44`, public reads snapshot only).
   Decision (already made, implement it): when a price/compare-at price changes on a variant of a **published** product, in the same transaction append a new `product_version` that copies the current published snapshot and replaces only that variant's price fields, `publishedBy` = the price editor. Draft content edits still need a normal publish. Audit stays `price.change` (plus whatever the publish audit shape is, so the history is complete). Also block clearing the price of an active variant of a published product (ticket 09 left this open). HTTP tests: accountant changes price → `/api/products/:slug` shows the new price; draft content edits made meanwhile do NOT leak into that snapshot.
2. **Commitments go into the published snapshot.** `api/src/routes/public-products.ts:114` reads `publicCommitments` live; CODING_STANDARDS "Snapshot đã xuất bản" says customer endpoints read only the snapshot. Add commitments to `ProductSnapshot` (`api/src/catalog/publication.ts`), write them at publish, read them from the snapshot. Fix the comment there. HTTP test: adding/removing a commitment after publishing does not change the public page until re-publish.
3. **`PUT /api/admin/products/:id/variants/:variantId` has no `requirePermission`** (`api/src/routes/admin-products.ts:161`; ADR 0002, CODING_STANDARDS "Ghi dữ liệu"). Gate it with `requirePermission('catalog.edit', 'price.edit')`, keep the per-field checks inside. HTTP test: staff with neither gets 403 even for a no-change save.
4. **EXIF/GPS leak:** `api/src/media/images.ts:69` uploads original bytes to the public bucket (also brand logos). Strip metadata from the stored original (apply EXIF orientation first, e.g. sharp `.rotate()`, re-encode in the same format) before upload. HTTP/unit-level test through the upload endpoint: the stored original (InMemoryStorage) has no EXIF.
5. **Intermittent 500 on image reorder** (`api/test/product-images.test.ts` ~256; `admin-product-images.ts:127-158`). Reviewer's hypothesis: Prisma interactive-transaction timeout (P2028, default maxWait 2s / timeout 5s) under sharp CPU load. Confirm from the captured app logs (`logs()` in test-app) by running the file in a loop alongside load, fix the cause (e.g. explicit transaction options in `audited()`, fewer round trips: one UPDATE for reorder), and record what you found.
6. **Test connection usage:** test app pools are uncapped (PrismaPg up to 10, pg-boss up to 10 per test, parallel files). Cap pool `max` in `api/test/support/test-app.ts` (small, e.g. 2–3 each) and bring `max_connections` in `api/test/support/global-setup.ts` back to a moderate value (or drop the override) if the suite stays green over 3 full runs.

## Standards / smells

7. Admin pages `web/app/pages/admin/products/[id].vue:212` and `admin/products/index.vue:39` use bare `$fetch`; use `useAdminSession().adminFetch` (CODING_STANDARDS "Web").
8. Duplicated token flow in `api/src/customers/email-verification.ts` and `password-reset.ts` (create token → link → sendEmail; claim = findUnique → updateMany usedAt null & not expired → count===0). Extract one helper.
9. Repeated route helpers: `const ProductParams = z.object({ id: z.uuid() })` (5 files), `const invalid = …` (3), `ORDER` (`admin-product-images.ts:37` = `publication.ts:44`), the P2002 `rethrow*Taken` mappers (5, incl. admin-brands/admin-categories). Share them (e.g. a `uniqueViolation(err, () => AppError)` helper in `api/src/http/`).
10. `saveVariant(…, variantId: string | null, …)` uses null to mean "create" (`admin-products.ts:173-250`); split into create/update so `before!`/`before?.` go away.
11. `web/app/components/EvidencedCommitments.vue:19` hard-codes `kind === 'warranty' ? 'Bảo hành' : …`; use a label map shared with the admin page.

## Not to change (record only, already decided or owner's call)
- Category hide hides subtree; search index updates only on publish (ticket 12); SKU prefix from 3 chars; nullable variant price before publish; old-slug 301 redirect; document upload gated by `document.view` — check ticket 13's text: if it names a permission for uploading documents, follow it, otherwise keep and note it.
- Live attribute schema labels on the public page: leave, note in ticket 11 decisions as known.
