# 04: Nhóm danh mục và sản phẩm

**What to build:**
- Các module catalog còn lại.

**Blocked by:** 02, 03

**Status:** resolved

- [x] Mỗi module (`brand`, `attribute-schema`, `commitment-type`, `product`, `product-import`) có đủ các lớp theo spec, mục "Cấu trúc thư mục"; module khác chỉ import qua `index.ts`.
- [x] Code cũ của nhóm này (route trong `routes/`, file trong thư mục miền cũ) bị xóa; `app.ts`/`modules/index.ts` gắn module mới.
- [x] Chuyển trạng thái nào cũng khóa dòng; audit trong transaction; thông điệp lỗi, `fields`, nội dung audit giữ nguyên từng chữ.
- [x] Typecheck, lint, bộ test api (CI) và `pnpm smoke` xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.

**Quyết định khi triển khai (2026-11-28):**
- Mỗi module một commit: `brand` 3c44c6f, `commitment-type` d9b11fe, `attribute-schema` 6ca7fd0, `product` c5b7d08, `product-import` 9a4ceb0.
- `brand`, `commitment-type` dùng `BaseCrudService`. `attribute-schema` lấy loại sản phẩm làm khóa nên service là class thường; phần đọc tách thành `AttributeSchemaQuery`, cùng cách với `category.query.ts`; code cũ chưa chuyển dùng `attributeSchemaQuery` export từ `index.ts`.
- `product` gồm cả ảnh, chứng từ, cam kết, xuất bản, tìm kiếm, route khách, vì phải chuyển cùng lúc: router `/products` có `.use(requirePermission(...))` chung, gắn trước router cũ thì chặn nhầm các router con có quyền riêng. Module có ba service (`ProductService`; `ProductMediaService` cho ảnh và chứng từ; `ProductCommitmentService`) và ba controller tương ứng, dùng chung `ProductRepository`. `product.model.ts` chứa `ProductSnapshot`; `catalog/search.ts` chuyển nguyên (git mv) thành `product-search.repository.ts`.
- Code cũ chưa chuyển: chatbot dựng query qua `createProductQuery`; đặt đơn, đặt trước, đổi hàng đọc biến thể giỏ qua hàm `cartVariants` export từ `index.ts`; tồn kho và ưu đãi đặt trước là port.
- `product-import`: `catalog/import.ts` chuyển nguyên (git mv) thành `product-import.plan.ts` (đọc Excel, file mẫu, lập kế hoạch; vẫn đọc DB qua `db` được truyền vào). Phần ghi chuyển vào repository và service; tồn đầu kỳ đi qua port tồn kho.
- Thứ tự parse giữ nguyên ở mọi route: id trên URL trước body, nên controller tự parse thay vì dùng `validate`.
- `deleteImageFilesQuietly`, `deleteDocumentFileQuietly` nhận `{ log }` (`req` vẫn khớp kiểu), để service không cần `req`.
- `app.ts`: mount `staff` bỏ qua đăng nhập khi `req.staff` đã có, vì đường dẫn lồng nhau (`/products/:id/images`, `/products/:id`, `/products`) đi qua nhiều mount; trước đó mỗi mount đọc lại nhân viên từ DB.
- Thư mục `catalog/` không còn. Bộ test api (cần Docker) chạy trên CI.
