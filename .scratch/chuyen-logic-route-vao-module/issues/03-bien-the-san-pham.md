# 03: Chuyển tạo và sửa biến thể vào `catalog/variants.ts`

**What to build:**
- Tạo và sửa biến thể thành hàm của module, không nhận `req`. Quy tắc "đổi trường nào cần quyền nào" nằm trong module.

**Blocked by:** —

**Status:** resolved

- [x] `catalog/variants.ts` export `createVariant(tx, audit, actor, productId, input)` và `updateVariant(tx, audit, actor, productId, variantId, input)`, với `actor: { staffId, canEditCatalog, canEditPrice }`.
- [x] `resolveFields`, `assertVariant` và các helper audit của biến thể chuyển theo nếu chỉ dùng ở đây.
- [x] Giữ nguyên:
  - quyền: tạo kèm giá cần `price.edit`; đổi trường cần `catalog.edit`; đổi giá cần `price.edit`;
  - các quy tắc: tổ hợp không trùng, còn biến thể đang bán, sản phẩm đã xuất bản phải có giá;
  - đổi giá lên website qua `publishPrice` cùng audit `catalog.product.publish`;
  - không đổi gì thì trả biến thể hiện tại, không ghi gì.
- [x] Route dựng `actor` từ `currentStaff(req)` và `hasPermission`, rồi gọi module trong `audited()`.
- [x] `products.test.ts`, `product-publishing.test.ts` và cả bộ test api xanh mà không sửa.

Spec: mục "Solution".

**Quyết định khi triển khai (2026-11-25):**
- `catalog/variants.ts` (173 dòng) export `createVariant`, `updateVariant` và kiểu `VariantActor`. `resolveFields`, `assertVariant` và `skuTaken` chuyển theo, không export. Các helper audit của biến thể vẫn ở `catalog/products.ts`, vì đã nằm sẵn ở đó. Route giảm từ 325 còn 169 dòng.
- Route dựng `actor` bằng `variantActor(req)`. Quyền giờ được đọc một lần lúc dựng, thay vì đọc khi cần; `hasPermission` chỉ đọc quyền đã nạp nên kết quả không đổi.
- `pnpm --filter api test`: 84 file, 821 test xanh, không sửa test. Typecheck, ESLint, Prettier sạch.
