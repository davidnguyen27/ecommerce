# 04: `adminRoutes` nhận `deps`

**What to build:**
- `adminRoutes` nhận một object như `checkoutRoutes(deps)` và các router khác, thay cho năm tham số theo vị trí.

**Blocked by:** —

**Status:** resolved

- [x] `routes/admin.ts`: `adminRoutes(deps: Pick<AppDeps, 'prisma' | 'storage' | 'payments' | 'emails' | 'siteUrl' | 'llm'>)`. Bên trong vẫn truyền tiếp cho các router con như hiện nay; không đổi chữ ký router con trong ticket này.
- [x] `app.ts` gọi `adminRoutes(deps)`.
- [x] Typecheck, lint, cả bộ test api xanh mà không sửa.

Spec: mục "Problem Statement" 4.

**Quyết định khi triển khai (2026-11-27):**
- Đầu hàm lấy `prisma`, `storage`, `payments`, `llm` ra từ `deps` và dựng `mail` từ `emails` cùng `siteUrl`, nên thân `adminRoutes` không đổi.
- Bộ test api (cần Docker) chạy trên CI.
