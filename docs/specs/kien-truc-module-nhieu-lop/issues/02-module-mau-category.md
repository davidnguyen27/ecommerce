# 02: Module mẫu `category`

**What to build:**
- Danh mục là module CRUD đầu tiên đi qua `BaseCrudService`: chốt khuôn cho các module CRUD.

**Blocked by:** 01

**Status:** resolved

- [x] `modules/category/` đủ lớp, sinh bằng `gen:module` rồi điền. Route admin (`/api/admin/categories`) và public (`/api/categories`).
- [x] `lockTree` (`pg_advisory_xact_lock`) và `assertValidParent` thành method của repository/service; giữ thứ tự khóa.
- [x] Ẩn/hiện, sửa không đổi gì thì 200 và không ghi audit (qua `beforeUpdate` trả `null`).
- [x] Xóa `routes/admin-categories.ts`, phần danh mục của `routes/public-catalog.ts`, `catalog/categories.ts`.
- [x] Nếu khuôn phải sửa thì sửa luôn template generator, ghi vào phần quyết định của ticket.
- [x] `categories.test.ts` và cả bộ test api xanh mà không sửa.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.

**Quyết định khi triển khai (2026-11-28):**
- Sinh khung bằng `gen:module`, rồi điền. Module có thêm `category.query.ts` (`CategoryQuery`): phần đọc cây cho module khác. Nó chỉ cần repository, nên code cũ chưa chuyển (`catalog/public-products.ts`, `routes/public-sitemap.ts`) dùng một bản `categoryQuery` export từ `index.ts`. Gỡ khi các phần đó chuyển (ticket 04, 09).
- Sửa khuôn (đã sửa lớp nền; template không phải đổi):
  - `BaseCrudService`: thêm `updateWith(id, ctx, action, change)` cho update có quy tắc riêng (ẩn, hiện) và hook `lockForUpdate`. Danh mục khóa cây (advisory lock) rồi mới khóa dòng ở mọi thao tác ghi, cùng thứ tự với xóa, để tránh deadlock giữa xóa và đổi cha. Trước đây sửa/ẩn/hiện không khóa dòng; giờ chặt hơn, kết quả không đổi.
  - `BaseCrudController` nhận `CrudService` dạng cấu trúc (`getItem`, `create`, `update`) thay cho `BaseCrudService` đúng tham số kiểu, vì service ghi kiểu rộng hơn DTO (ẩn ghi `{ hidden: true }`). Thêm `idOf(req)` override được: danh mục parse `z.uuid()` để id sai vẫn là 400 như cũ.
- Kiểu `Update` của service là `Prisma.CategoryUncheckedUpdateInput`; PUT nhận `UpdateCategoryInput` qua override `update`.
- Bộ test api (cần Docker) chạy trên CI.
