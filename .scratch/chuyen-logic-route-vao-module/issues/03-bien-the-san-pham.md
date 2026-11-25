# 03: Chuyển tạo và sửa biến thể vào `catalog/variants.ts`

**What to build:**
- Tạo và sửa biến thể thành hàm của module, không nhận `req`. Quy tắc "đổi trường nào cần quyền nào" nằm trong module.

**Blocked by:** —

**Status:** ready-for-agent

- [ ] `catalog/variants.ts` export `createVariant(tx, audit, actor, productId, input)` và `updateVariant(tx, audit, actor, productId, variantId, input)`, với `actor: { staffId, canEditCatalog, canEditPrice }`.
- [ ] `resolveFields`, `assertVariant` và các helper audit của biến thể chuyển theo nếu chỉ dùng ở đây.
- [ ] Giữ nguyên:
  - quyền: tạo kèm giá cần `price.edit`; đổi trường cần `catalog.edit`; đổi giá cần `price.edit`;
  - các quy tắc: tổ hợp không trùng, còn biến thể đang bán, sản phẩm đã xuất bản phải có giá;
  - đổi giá lên website qua `publishPrice` cùng audit `catalog.product.publish`;
  - không đổi gì thì trả biến thể hiện tại, không ghi gì.
- [ ] Route dựng `actor` từ `currentStaff(req)` và `hasPermission`, rồi gọi module trong `audited()`.
- [ ] `products.test.ts`, `product-publishing.test.ts` và cả bộ test api xanh mà không sửa.

Spec: mục "Solution".
