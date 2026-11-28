# 08: Nhóm tài khoản, nhân viên, audit

**What to build:**
- Đăng nhập nhân viên và khách, tài khoản khách, quản lý nhân viên, xem audit. Giới hạn tần suất đăng nhập, quên mật khẩu, đăng ký giữ nguyên.

**Blocked by:** 02, 03

**Status:** resolved

- [x] Mỗi module (`auth`, `staff`, `customer-auth`, `customer`, `audit-log`) có đủ các lớp theo spec, mục "Cấu trúc thư mục"; module khác chỉ import qua `index.ts`.
- [x] Code cũ của nhóm này (route trong `routes/`, file trong thư mục miền cũ) bị xóa; `app.ts`/`modules/index.ts` gắn module mới.
- [x] Chuyển trạng thái nào cũng khóa dòng; audit trong transaction; thông điệp lỗi, `fields`, nội dung audit giữ nguyên từng chữ.
- [x] Typecheck, lint, bộ test api (CI) và `pnpm smoke` xanh mà không sửa test.

Spec: `docs/specs/kien-truc-module-nhieu-lop/spec.md`.

**Quyết định khi triển khai (2026-11-28):**
- `access-token.ts`, `password.ts` chuyển vào `core/auth/` (không vào module `auth` như bảng trong spec): `require-auth` ở core dùng chúng, mà core không được import module. `normalizeEmail` tách ra `core/auth/email.ts`.
- `auth/session-routes.ts` tách thành `SessionService` (đăng nhập, xoay vòng, đăng xuất; không có HTTP) và `SessionController` (header `X-Client`, cookie). `createSessions` dựng phiên cho từng miền: module `auth` cho nhân viên (`/api/admin/auth`), `customer-auth` cho khách (`/api/auth`). `refresh-tokens.ts` chuyển nguyên thành `auth/refresh-token.ts`.
- `customers/*` chuyển nguyên vào `customer-auth/`. Module `customer` (`/api/account`) mở phiên mới sau khi đổi mật khẩu qua `CustomerAuthModule.sessions`; gắn sau các route `/account/…` khác.
- `seedOwner` ở `staff/staff.seed.ts`, export qua `staff/index.ts` cho lệnh seed và test.
- Sửa nhân viên vẫn khóa advisory `staff.owners` trước khi đọc dòng (chặn hai owner hạ quyền nhau), như cũ.
- Test chỉ đổi đường dẫn import (`test/support/staff.ts`). Bộ test api (cần Docker) chạy trên CI.
