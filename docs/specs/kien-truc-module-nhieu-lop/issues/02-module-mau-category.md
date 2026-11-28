# 02: Module mẫu `category`

**What to build:**
- Danh mục là module CRUD đầu tiên đi qua `BaseCrudService`: chốt khuôn cho các module CRUD.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] `modules/category/` đủ lớp, sinh bằng `gen:module` rồi điền. Route admin (`/api/admin/categories`) và public (`/api/categories`).
- [ ] `lockTree` (`pg_advisory_xact_lock`) và `assertValidParent` thành method của repository/service; giữ thứ tự khóa.
- [ ] Ẩn/hiện, sửa không đổi gì thì 200 và không ghi audit (qua `beforeUpdate` trả `null`).
- [ ] Xóa `routes/admin-categories.ts`, phần danh mục của `routes/public-catalog.ts`, `catalog/categories.ts`.
- [ ] Nếu khuôn phải sửa thì sửa luôn template generator, ghi vào phần quyết định của ticket.
- [ ] `categories.test.ts` và cả bộ test api xanh mà không sửa.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.
